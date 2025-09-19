const sgMail = require("@sendgrid/mail");
const dotenv = require("dotenv");
dotenv.config();
// Set the API key for SendGrid from your environment variables if present
const hasSendgrid =
  !!process.env.SENDGRID_API_KEY && !!process.env.SENDER_EMAIL;
if (hasSendgrid) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  console.warn("SendGrid not configured. Emails will not be sent.");
}

/**
 * Sends an email using SendGrid.
 * Supports both raw emails and dynamic templates.
 *
 * @param {object} options - The email options.
 * @param {string} options.to - The recipient's email address.
 * @param {string} [options.subject] - The subject line (only for non-template emails).
 * @param {string} [options.text] - Plain text body (optional).
 * @param {string} [options.html] - HTML body (optional).
 * @param {string} [options.templateId] - SendGrid dynamic template ID.
 * @param {object} [options.dynamicTemplateData] - Data for dynamic templates.
 */
const sendEmail = async (options) => {
  if (!hasSendgrid) {
    console.warn(
      `sendEmail called without SendGrid configuration. Intended recipient: ${options.to}`
    );
    return;
  }

  const msg = {
    to: options.to,
    from: {
      name: "BuzzTalk",
      email: process.env.SENDER_EMAIL, // verified sender email
    },
    subject: "Your BuzzTalk verification code",
  };

  if (options.templateId) {
    // Use SendGrid Dynamic Template
    msg.templateId = options.templateId;
    // Ensure subject is available inside template variables as {{subject}}
    const subjectFallback =
      options.subject || "Your BuzzTalk verification code";
    msg.dynamicTemplateData = {
      subject: subjectFallback,
      ...(options.dynamicTemplateData || {}),
    };
    // Also set top-level subject; some providers may display this even with templates
    msg.subject = subjectFallback;
  } else {
    // Use plain email
    msg.subject = options.subject || "Your BuzzTalk verification code";
    msg.text = options.text;
    msg.html = options.html;
  }

  try {
    await sgMail.send(msg);
    console.log(`Email sent successfully to ${options.to}`);
  } catch (error) {
    console.error("Error sending email:", error);

    if (error.response) {
      console.error(error.response.body);
    }

    throw new Error("Email could not be sent.");
  }
};

module.exports = sendEmail;
