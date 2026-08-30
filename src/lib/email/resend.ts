import { Resend } from "resend";
import { getEnv } from "@/lib/env";

let client: Resend | undefined;

function getClient(): Resend {
  if (!client) {
    client = new Resend(getEnv().RESEND_API_KEY);
  }
  return client;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ id: string | null }> {
  const res = await getClient().emails.send({
    // Resend's shared onboarding@resend.dev sender works with no domain
    // verification, but only delivers to the email address on the Resend
    // account itself — fine for personal, single-recipient use. Verify a
    // custom domain in Resend and swap this if that ever changes.
    from: "Coach App <onboarding@resend.dev>",
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
  if (res.error) {
    throw new Error(`Resend send failed: ${res.error.message}`);
  }
  return { id: res.data?.id ?? null };
}
