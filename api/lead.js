import { Resend } from "resend";

const OPERATOR_EMAIL = "naminimiya@gmail.com";
const FROM = "ARO 진단 신청 <onboarding@resend.dev>";

function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmailHtml({ name, email, submittedAt, diagnosis }) {
  const json = JSON.stringify(diagnosis, null, 2);
  return `
<div style="font-family:Apple SD Gothic Neo,Noto Sans KR,sans-serif;line-height:1.7;color:#111">
  <h2 style="margin:0 0 16px">[ARO 진단 신청]</h2>
  <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
    <tr><td style="background:#f6f6f4;width:120px"><b>신청 시각</b></td><td>${escapeHtml(submittedAt)}</td></tr>
    <tr><td style="background:#f6f6f4"><b>이름</b></td><td>${escapeHtml(name)}</td></tr>
    <tr><td style="background:#f6f6f4"><b>이메일</b></td><td>${escapeHtml(email)}</td></tr>
  </table>
  <h3 style="margin:24px 0 8px">진단 결과 (JSON)</h3>
  <pre style="background:#f6f6f4;padding:16px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word">${escapeHtml(json)}</pre>
  <p style="font-size:12px;color:#737373;margin-top:24px">이 메일은 ARO 진단 페이지의 신청 폼에서 자동 발송된 알림입니다.</p>
</div>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, diagnosis, consent } = req.body || {};

  if (!name || typeof name !== "string" || name.length < 1 || name.length > 50) {
    return res.status(400).json({ error: "이름을 1~50자로 입력해주세요." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "올바른 이메일 형식이 아닙니다." });
  }
  if (!consent) {
    return res.status(400).json({ error: "개인정보 처리에 동의해야 신청할 수 있습니다." });
  }
  if (!diagnosis || typeof diagnosis !== "object") {
    return res.status(400).json({ error: "진단 결과가 누락되었습니다." });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "서버 설정 오류: RESEND_API_KEY가 설정되지 않았습니다." });
  }

  const submittedAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = `[ARO 진단 신청] ${name} / ${submittedAt}`;
  const html = renderEmailHtml({ name, email, submittedAt, diagnosis });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: [OPERATOR_EMAIL],
      replyTo: email,
      subject,
      html,
    });
    if (error) {
      console.error("Resend error:", error);
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("lead handler failed:", err?.message || err);
    return res.status(200).json({ ok: true });
  }
}
