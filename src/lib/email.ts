import sgMail from '@sendgrid/mail';

// Initialize SendGrid with API key
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail({ to, subject, text, html }: SendEmailParams): Promise<boolean> {
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error('Email configuration missing: SENDGRID_API_KEY or EMAIL_FROM not set');
    return false;
  }

  try {
    await sgMail.send({
      to,
      from,
      subject,
      text,
      html,
    });
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error('SendGrid email error:', error);
    return false;
  }
}

export async function sendPasswordResetEmail(
  to: string,
  resetToken: string,
  userName: string
): Promise<boolean> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const resetLink = `${appUrl}/reset-password?token=${resetToken}`;

  const subject = 'Password Reset Request - Savvy Dashboard';

  const text = `
Hi ${userName},

You requested to reset your password for the Savvy Dashboard.

Click this link to reset your password (expires in 1 hour):
${resetLink}

If you didn't request this, you can safely ignore this email.

NOTE: This email was sent from an automated system. If you don't see future emails from us, please check your spam folder and mark as "Not Spam".

- The Savvy Dashboard Team

---
Savvy Wealth | New York, NY
This is an automated message from the Savvy Dashboard.
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Savvy Dashboard</h1>
  </div>
  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin-top: 0;">Reset Your Password</h2>
    <p>Hi ${userName},</p>
    <p>You requested to reset your password for the Savvy Dashboard.</p>
    <p>Click the button below to set a new password:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Reset Password</a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour.</p>
    <p style="color: #6b7280; font-size: 14px;">If you didn't request this password reset, you can safely ignore this email.</p>

    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin-top: 20px;">
      <p style="margin: 0; font-size: 13px; color: #92400e;">
        <strong>📧 Don't see our emails?</strong> Check your spam folder and mark this email as "Not Spam" to receive future notifications.
      </p>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${resetLink}" style="color: #667eea; word-break: break-all;">${resetLink}</a>
    </p>
  </div>

  <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 11px;">
    <p style="margin: 0;">Savvy Wealth | New York, NY</p>
    <p style="margin: 5px 0 0 0;">This is an automated message from the Savvy Dashboard.</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail({ to, subject, text, html });
}
