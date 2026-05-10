import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { userId, phoneNumber, network, dataPlan, amount, origPrice } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch user
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userErr || !user) throw new Error("User not found");

    // Check balance
    if (user.dashboard_balance < amount) {
      return new Response(JSON.stringify({ error: "Insufficient balance" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map network to Clubkonnect code
    const networkMap: Record<string, string> = {
      MTN: "01", Airtel: "03", Glo: "02", "9mobile": "04",
    };
    const networkCode = networkMap[network] || "01";

    // Unique request ID
    const requestId = `SUB-${Date.now()}-${userId.slice(0, 8)}`;

    // Call Clubkonnect
    const ckUrl = `https://www.clubkonnect.com/APIGetDataBundleV1.asp` +
      `?UserID=${Deno.env.get("CLUBKONNECT_USER_ID")}` +
      `&APIKey=${Deno.env.get("CLUBKONNECT_API_KEY")}` +
      `&MobileNetwork=${networkCode}` +
      `&DataPlan=${dataPlan}` +
      `&MobileNumber=${phoneNumber}` +
      `&RequestID=${requestId}`;

    const ckRes = await fetch(ckUrl);
    const ckData = await ckRes.json();

    const success = ckData.status === "00" || ckData.Status === "00";

    // Calculate subsidy drain
    // Deduct ₦90, refund ₦10 + 3% commission on original price
    const commission = Math.round(origPrice * 0.03);
    const netDrain = 90 - 10 - commission; // typically ~71
    const newSubsidyFund = Math.max(0, user.subsidy_fund - netDrain);
    const newDiscountLeft = Math.floor(newSubsidyFund / 100);
    const newBalance = user.dashboard_balance - amount;

    // Record transaction
    const { data: txn } = await supabase.from("transactions").insert({
      user_id: userId,
      phone_number: phoneNumber,
      network,
      data_plan: dataPlan,
      amount,
      cashback_earned: commission,
      status: success ? "success" : "failed",
      clubkonnect_ref: requestId,
    }).select().single();

    if (success) {
      // Update user balances
      await supabase.from("users").update({
        dashboard_balance: newBalance,
        subsidy_fund: newSubsidyFund,
        discount_purchases_left: newDiscountLeft,
      }).eq("id", userId);

      // Log cashback
      await supabase.from("cashback_log").insert({
        user_id: userId,
        amount: commission,
        transaction_id: txn.id,
        paid_out: false,
      });
    }

    return new Response(JSON.stringify({
      success,
      newBalance,
      newSubsidyFund,
      discountPurchasesLeft: newDiscountLeft,
      message: success ? "Data purchased successfully" : "Purchase failed",
      ckResponse: ckData,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
