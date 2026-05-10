import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hash } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { cardCode, pin } = await req.json();

    if (!cardCode || cardCode.length !== 10 || !/^\d{10}$/.test(cardCode)) {
      return new Response(JSON.stringify({ error: "Invalid card code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if card already registered
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("card_code", cardCode)
      .single();

    if (existing) {
      return new Response(JSON.stringify({ error: "Card already registered" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate username from card code
    const adjectives = ["swift","calm","bold","bright","cool","sharp","kind","wise","quick","pure"];
    const nouns = ["star","wave","flame","stone","spark","cloud","river","hawk","peak","grove"];
    const idx1 = parseInt(cardCode[0]) % adjectives.length;
    const idx2 = parseInt(cardCode[9]) % nouns.length;
    const suffix = cardCode.slice(7, 10);
    const username = adjectives[idx1] + nouns[idx2] + suffix;

    // Hash PIN
    const pinHash = await hash(pin);

    // Renewal date = 28 days from now
    const renewalDate = new Date();
    renewalDate.setDate(renewalDate.getDate() + 28);

    // Insert user
    const { data: user, error } = await supabase
      .from("users")
      .insert({
        username,
        card_code: cardCode,
        pin_hash: pinHash,
        dashboard_balance: 500,
        subsidy_fund: 500,
        discount_purchases_left: 5,
        renewal_date: renewalDate.toISOString(),
        wallet_balance: 500,
        cashback_balance: 0,
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, username, userId: user.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
