import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RENEWAL_AMOUNT = 700;
const RENEWAL_SUBSIDY = 350;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, paystackReference, amount } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify payment with Paystack
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${paystackReference}`,
      { headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}` } }
    );
    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data.status !== "success") {
      return new Response(JSON.stringify({ error: "Payment not verified" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm amount matches (Paystack returns in kobo)
    const paidAmount = paystackData.data.amount / 100;
    if (paidAmount < amount) {
      return new Response(JSON.stringify({ error: "Amount mismatch" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for duplicate reference
    const { data: existing } = await supabase
      .from("deposits")
      .select("id")
      .eq("payment_reference", paystackReference)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ error: "Payment already processed" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record deposit
    await supabase.from("deposits").insert({
      user_id: userId,
      amount: paidAmount,
      payment_reference: paystackReference,
      status: "confirmed",
    });

    // Fetch current user
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    let updatePayload: Record<string, unknown> = {};

    if (paidAmount === RENEWAL_AMOUNT) {
      // Card renewal — refill subsidy to ₦350
      const renewalDate = new Date();
      renewalDate.setDate(renewalDate.getDate() + 28);

      updatePayload = {
        subsidy_fund: RENEWAL_SUBSIDY,
        discount_purchases_left: Math.floor(RENEWAL_SUBSIDY / 100), // 3
        renewal_date: renewalDate.toISOString(),
      };
    } else {
      // Regular wallet deposit
      updatePayload = {
        dashboard_balance: (user.dashboard_balance || 0) + paidAmount,
      };
    }

    await supabase.from("users").update(updatePayload).eq("id", userId);

    return new Response(JSON.stringify({
      success: true,
      isRenewal: paidAmount === RENEWAL_AMOUNT,
      message: paidAmount === RENEWAL_AMOUNT
        ? "Card renewed. Subsidy refilled to ₦350 (3 purchases)."
        : `₦${paidAmount} added to your wallet.`,
      ...updatePayload,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
