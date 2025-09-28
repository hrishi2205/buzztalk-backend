const sgMail = require("@sendgrid/mail");

/**
 * Lightweight SendGrid wrapper used by auth routes.
 * Falls back to console logging if SENDGRID_API_KEY / SENDER_EMAIL not configured.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject (ignored if templateId provided)
 * @param {string} [options.text] - Plain text body (optional)
 * @param {string} [options.html] - HTML body (optional)
 * @param {string} [options.templateId] - Dynamic template ID
 * @param {Object} [options.dynamicTemplateData] - Data for dynamic template
 */
module.exports = async function sendEmail(options = {}) {
  const { to, subject, text, html, templateId, dynamicTemplateData } = options;
  if (!to) throw new Error("sendEmail: 'to' is required");

  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDER_EMAIL;
  if (!apiKey || !from) {
    // Graceful fallback: just log content so flows can proceed in dev
    console.warn("[sendEmail] SENDGRID not configured. Logging email instead.");
    console.info("To:", to);
    console.info("Subject:", subject);
    if (templateId) {
      console.info("Template:", templateId, "Data:", dynamicTemplateData);
    } else {
      console.info("Text:", text);
      console.info("HTML:", html);
    }
    return { mocked: true };
  }

  try {
    sgMail.setApiKey(apiKey);
    const msg = {
      to,
      from,
    };
    if (templateId) {
      msg.templateId = templateId;
      if (dynamicTemplateData) msg.dynamicTemplateData = dynamicTemplateData;
    } else {
      msg.subject = subject || "Notification";
      if (html) msg.html = html;
      if (text) msg.text = text || html?.replace(/<[^>]+>/g, " ");
    }
    await sgMail.send(msg);
    return { sent: true };
  } catch (e) {
    console.error("[sendEmail] Error sending email:", e.message);
    throw e;
  }
};
