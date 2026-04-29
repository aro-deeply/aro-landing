# 진단 엔진 통합 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 랜딩페이지(`index.html`)의 진단 CTA에서 시작해, 백엔드(Vercel Serverless)에서 Claude API를 호출하여 이력서 진단 결과를 사용자에게 보여주고, 신청자 정보를 운영자 메일로 알리는 흐름을 완성한다. API 키는 절대 클라이언트에 노출되지 않는다.

**Architecture:** Vercel 정적 호스팅 + Serverless Functions. `/api/diagnose`는 Cloudflare Turnstile 검증 후 Anthropic Claude API를 호출하고, `/api/lead`는 Resend로 운영자 메일을 발송한다. `archive/aro-diagnosis.html`을 루트로 옮겨 `diagnosis.html`로 만들고, 클라이언트 직접 호출 코드를 백엔드 호출로 교체한다.

**Tech Stack:** HTML/CSS/JavaScript(ES Module), React 18 + Tailwind + Babel via CDN(빌드 도구 없음), Vercel Serverless Functions(Node 20+), `@anthropic-ai/sdk`, `resend`, Cloudflare Turnstile.

**참고 문서:** `DESIGN.md` (이 플랜의 전제가 되는 설계서)

---

## Phase 0 — 사전 준비 (사용자 액션)

### Task 0: 외부 서비스 가입과 키 발급

**누가:** 사용자 본인 (Claude는 코드만 작성)
**참고:** `DESIGN.md` 5장에 단계 안내 있음

- [ ] **Step 1: Anthropic Console 자동 충전 OFF 확인**
  - https://console.anthropic.com → Plans & Billing → Auto-reload OFF
  - 결과: $20 prepaid가 절대 한도가 됨

- [ ] **Step 2: Resend 가입 + API 키 발급**
  - https://resend.com → 가입(반드시 `naminimiya@gmail.com`으로 가입)
  - Dashboard → API Keys → Create → `re_...` 복사 보관

- [ ] **Step 3: Cloudflare Turnstile 사이트 등록**
  - https://www.cloudflare.com → Turnstile → Add site
  - Domain: `aro-landing.vercel.app` + `localhost`
  - Widget Mode: Managed
  - Site Key, Secret Key 두 개 메모

- [ ] **Step 4: Vercel 환경변수 4개 등록**
  - Vercel → 프로젝트 → Settings → Environment Variables
  - `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` 모두 Production/Preview/Development 체크
  - **이 단계는 Phase 1~3가 끝나기 전이라도 미리 해둘 수 있음.**

> Phase 1부터는 코드 작업. Task 0이 끝나지 않아도 코드 작성은 가능하지만, **최종 검증(Task 13)에서는 환경변수 4개가 등록되어 있어야 함.**

---

## Phase 1 — 백엔드 함수

### Task 1: 프로젝트 인프라 (`package.json`, `.gitignore`)

**Files:**
- Create: `C:\Users\user\Desktop\aro-landing\package.json`
- Create: `C:\Users\user\Desktop\aro-landing\.gitignore`

- [ ] **Step 1: `.gitignore` 작성**

```
# Dependencies
node_modules/

# Vercel
.vercel
.env
.env.*
!.env.example

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
```

- [ ] **Step 2: `package.json` 작성**

```json
{
  "name": "aro-landing",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "ARO landing + AI diagnosis backend",
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "resend": "^4.0.0"
  }
}
```

- [ ] **Step 3: 의존성 설치**

```bash
cd "C:\Users\user\Desktop\aro-landing"
npm install
```

기대 결과: `node_modules/`, `package-lock.json` 생성. 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add .gitignore package.json package-lock.json
git -C "C:/Users/user/Desktop/aro-landing" commit -m "chore: add package.json and .gitignore for serverless backend"
```

---

### Task 2: `api/diagnose.js` — Claude API 호출 백엔드

**Files:**
- Create: `C:\Users\user\Desktop\aro-landing\api\diagnose.js`

이 함수는 (1) Turnstile 토큰을 Cloudflare에서 검증하고, (2) Anthropic Claude API를 호출하고, (3) JSON 결과를 클라이언트로 반환한다. 시스템 프롬프트는 클라이언트에 절대 두지 않고 여기서만 정의한다(보안·일관성).

- [ ] **Step 1: 함수 파일 작성**

```javascript
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `당신은 ARO 스튜디오의 커리어 디렉터 관점으로 이력서를 진단합니다. 16년 HR 경력, 1,000회 이상의 면접 진행, 150건 이상의 컨설팅 사례를 가진 평가자의 시선으로 판단합니다.

【진단 엔진 최상위 원칙】
1. 모든 판정의 뿌리는 "지원 회사와 직무에 대한 이해도"입니다. 이 이해가 부재하면 나머지 결함은 대부분 여기서 파생됩니다.
2. 범용 이력서(copy된 남의 이력서)는 근본 결함입니다. 가장 강도 있는 판정을 내립니다.
3. 결함의 성격을 "근본 결함"과 "교정 가능 결함"으로 구분합니다.
4. 이력서는 정보 전달이 아니라 이미지 각인입니다. 역량은 문서 전반에 분산 반복되어야 합니다.

【5개 패턴】
- Pattern 05 (뿌리): 업계 맥락 부재
- Pattern 01 (1차 증상): 규격화된 정형성
- Pattern 04 (1차 증상): 직무 적합성 어긋남
- Pattern 02 (2차 증상): 근거 부재와 과장
- Pattern 03 (2차 증상): 차별화 요소의 판단 오류

【판정 기준】
- Pattern 01: "고유성 가시성"과 "범용성 여부"가 최상위. 기여 범위 불명확, 과도한 기승전결, 주관적 성공 서술, 정제되지 않은 어투, 독자 설정 오류, 도입부 인상 부재
- Pattern 02: 납득 가능성 + 연차·회사 규모 정합성 + 주장-근거 쌍. 연차별 기준: 신입~1년차 평균은 지시받은 업무 수행, 2~3년차 평균은 독립 수행, 5년차 이상은 일부 리드
- Pattern 03: "스스로 먼저 부각하지 않는다" 원칙. "비록 ~은 아니지만" 구문은 약점 자발 부각. 업종 전환 3단 판정 (3-5년 이내 / 장기+접점 있음 / 장기+접점 없음)
- Pattern 04: 직급별 어필 축 (사원급 = 열정·도전·창의성, 팀장급 = 의사결정 전문성, 임원급 = 전체 조망+리스크 감수). 3박자 구조(시작, 내적 경험, 현재까지 남은 것)
- Pattern 05: "귀사" 호칭은 즉시 범용 판정. 회사 이해도 3단계

【현재 상황별 추가 판정 축】
- 동종업계 이직: 현 직장과 이직 대상 회사의 차별점을 이력서가 반영하고 있는지가 핵심 평가 축입니다. 같은 직무·업계이므로 "왜 지금 옮기는가", "이 회사에서만 할 수 있는 것이 무엇인가"에 대한 답이 드러나야 합니다.

【반전 인사이트】
- 아르바이트 수치 부풀리기는 무의미. 있는 그대로 기술이 유효
- "비록 ~은 아니지만" 구문은 약점을 스스로 부각. 굳이 넣지 않음
- 2년차의 총괄 리드 주장은 양면 불리
- 직무 적합성 어긋남은 교정 가능

【Voice 원칙 · 매우 중요】
- 모든 진단 문장은 "~합니다" 경어체로 작성합니다. "~다", "~이다" 등 평어체 금지
- 단정적이고 근거 기반의 전문성 있는 어조
- 구어체 어휘 금지 ("꼴이 된다", "두루뭉술", "콩가루")
- em dash 금지, 과장 부사 금지, 위로·격려 금지
- 동일 어휘 반복 금지. 유사어 분산 (서사/맥락/흐름, 연결고리/접점/연계, 범용/일반적/통용)
- 교정 가능성 명시

【매우 중요 · 종합 진단(one_pager_summary) 작성 규칙】
one_pager_summary는 반드시 다음 구조로 작성합니다:
1. 3~4개 단락으로 분리. 각 단락은 두 번의 줄바꿈(\\n\\n)으로 구분
2. 각 단락은 3~5문장 내외
3. 단락별 주제 분리: (1) 뿌리 원인 진단 (2) 표면 증상 분석 (3) 구체 지점 지적 (4) 교정 가능성과 다음 단계
4. 각 단락에서 가장 중요한 핵심 문장이나 구문은 **별표 두 개**로 감싸서 강조 (마크다운 볼드 문법). 단락당 1~2회 사용

【출력】
반드시 유효한 JSON 한 덩어리. 다른 텍스트 불가. evidence는 원문에서 직접 발췌. one_pager_summary는 600~900자. 모든 한국어 문장은 반드시 경어체(~합니다)로 작성.

【어휘 다양성 추가 지시】
진단 생성 시 "뿌리"라는 단어는 내부 개념 설명용으로만 사용하고, 실제 출력 텍스트(root_diagnosis, one_pager_summary 등)에서는 다음과 같이 유사어로 분산합니다:
- 뿌리 원인 → 근본 원인, 핵심 원인, 가장 깊은 층위, 최상위 원인

【표현 완화 지시 · 매우 중요】
단정적이고 부정적인 결론은 지원자에게 절망을 주므로, 다음과 같이 완화합니다:
- "가능성이 없습니다" → "가능성이 매우 낮습니다" 또는 "가능성이 제한적입니다"
- "불가능합니다" → "현재 상태로는 어렵습니다"
- "~할 수 없습니다" → "~하기 어렵습니다" 또는 "~하기에는 제약이 있습니다"
- "부재합니다" → "충분히 드러나지 않습니다" 또는 "확인되지 않습니다"
- "전혀 없습니다" → "거의 보이지 않습니다"
- 근본 결함이라 해도 "교정 가능" 여지를 반드시 함께 제시

진단은 객관적이되, 지원자가 개선 방향을 볼 수 있도록 서술합니다.

【evidence 작성 규칙 · 매우 중요 · 개인정보 보호】
evidence의 quote는 이력서 원문에서 발췌하되, 다음 정보는 반드시 제외하거나 마스킹합니다:
- 이름·회사명·학교명·기관명·소속명
- 전화번호·이메일·주소·생년월일·SNS ID
- 기타 고유명사로 개인을 특정할 수 있는 정보
식별정보가 포함된 문장이라면 해당 부분을 [...]로 가리거나, 식별정보가 없는 다른 문장을 발췌합니다.

【JSON 스키마】
{
  "root_cause": "pattern_01|pattern_02|pattern_03|pattern_04|pattern_05",
  "dominant_pattern": "동일 enum",
  "pattern_scores": {
    "pattern_01_generic_template": 0.0-1.0,
    "pattern_02_unsupported_claims": 0.0-1.0,
    "pattern_03_differentiation_mishandling": 0.0-1.0,
    "pattern_04_job_fit_mismatch": 0.0-1.0,
    "pattern_05_industry_context_absence": 0.0-1.0
  },
  "evidence": [{"quote": "원문 발췌 (식별정보 마스킹)", "signal": "Pattern 번호 · 신호명", "why": "평가 근거 (경어체)"}],
  "root_diagnosis": "근본 진단 2-3문장. 가장 핵심 구문은 **별표 두 개**로 감싸 강조",
  "key_verdict": "전체 진단을 한 문장으로 압축한 핵심 판정. 최대 60자 이내",
  "one_pager_summary": "3~4개 단락으로 \\n\\n 구분. 각 단락에서 핵심 구문은 **별표 두 개**로 강조. 600~900자",
  "correctability": "근본 결함 | 교정 가능 | 교정 가능하나 재검토 필요",
  "next_step_recommendation": "Rewrite | Rehearse | Direct",
  "self_reflection_questions": ["자가 성찰 질문 3개 (경어체, 물음표로 끝)"]
}`;

async function verifyTurnstile(token, ip) {
  const params = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (ip) params.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await r.json();
  return Boolean(data.success);
}

function buildUserMessage({ jobTarget, situation, resume, rejection }) {
  return `지원 직무: ${jobTarget}
현재 상황: ${situation}
이력서 본문:
${resume}
최근 탈락 경험: ${rejection || "기재되지 않음"}

위 입력에 대해 JSON 스키마에 따라 진단 결과를 생성해주세요.
- 모든 한국어 문장은 경어체(~합니다)로 작성
- root_diagnosis와 one_pager_summary에서 핵심 구문은 **별표 두 개**로 감싸 강조
- one_pager_summary는 반드시 3~4개 단락으로 \\n\\n 구분
- key_verdict는 전체 진단을 한 문장으로 압축
- JSON 외의 텍스트는 절대 포함하지 마세요`;
}

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { jobTarget, situation, resume, rejection, turnstileToken } = req.body || {};

  if (!jobTarget || !situation || !resume) {
    return res.status(400).json({ error: "필수 항목이 누락되었습니다." });
  }
  if (typeof resume !== "string" || resume.length < 50) {
    return res.status(400).json({ error: "이력서 본문은 50자 이상이어야 합니다." });
  }
  if (!turnstileToken) {
    return res.status(400).json({ error: "봇 검증 토큰이 누락되었습니다." });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null;
  const turnstileOk = await verifyTurnstile(turnstileToken, ip);
  if (!turnstileOk) {
    return res.status(403).json({ error: "봇 검증에 실패했습니다. 다시 시도해주세요." });
  }

  // 개발/Preview 환경에서 키가 없으면 안내
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "서버 설정 오류: ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다." });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: buildUserMessage({ jobTarget, situation, resume, rejection }) },
      ],
    });

    const text = response.content?.[0]?.text;
    if (!text) {
      return res.status(502).json({ error: "AI 응답이 비어있습니다. 잠시 후 다시 시도해주세요." });
    }

    let parsed;
    try {
      parsed = extractJson(text);
    } catch (e) {
      console.error("JSON parse fail:", text?.slice(0, 500));
      return res.status(502).json({ error: "AI 응답 형식이 잘못되었습니다. 잠시 후 다시 시도해주세요." });
    }

    return res.status(200).json({ result: parsed });
  } catch (err) {
    console.error("Anthropic call failed:", err?.message || err);
    return res.status(502).json({ error: "일시적 오류입니다. 잠시 후 다시 시도해주세요." });
  }
}
```

> 메모: `system`을 array of content blocks로 두고 `cache_control: { type: "ephemeral" }`을 적용해 prompt caching을 활성화함 — 시스템 프롬프트가 매 호출마다 동일한 큰 문자열이라 캐싱 효과가 큼.

- [ ] **Step 2: 검증 (수동)**
  - 파일 저장 후 에디터에서 syntax 에러 없는지 확인 (이 단계에서는 실제 호출 안 함)
  - 환경변수가 등록되어 있다면 Phase 4의 e2e 테스트에서 실제 호출

- [ ] **Step 3: 커밋**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add api/diagnose.js
git -C "C:/Users/user/Desktop/aro-landing" commit -m "feat(api): add /api/diagnose serverless function with Turnstile verify and Claude call"
```

---

### Task 3: `api/lead.js` — 운영자 알림 메일 백엔드

**Files:**
- Create: `C:\Users\user\Desktop\aro-landing\api\lead.js`

진단 결과 화면 하단의 "전문가 상담 신청" 폼이 제출되면 이 함수가 Resend로 운영자(`naminimiya@gmail.com`)에게 알림 메일을 보낸다.

- [ ] **Step 1: 함수 파일 작성**

```javascript
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
      // 사용자에게는 접수 완료로 보여줌 (사용자 책임 아님). 운영자만 로그로 인지.
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("lead handler failed:", err?.message || err);
    return res.status(200).json({ ok: true });
  }
}
```

> 메모: Resend 발송 실패 시에도 사용자에게는 200 OK를 반환한다(사용자 책임 아님 → 사용자 혼란 방지). 운영자(개발자)는 Vercel 로그에서 인지하고 직접 처리.

- [ ] **Step 2: 검증 (수동)**
  - 파일 저장 후 syntax 에러 없는지 확인

- [ ] **Step 3: 커밋**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add api/lead.js
git -C "C:/Users/user/Desktop/aro-landing" commit -m "feat(api): add /api/lead serverless function for operator notification via Resend"
```

---

## Phase 2 — 진단 페이지 변환

### Task 4: `archive/aro-diagnosis.html` → 루트 `diagnosis.html`로 복사

**Files:**
- Source (변경 없음): `C:\Users\user\Desktop\circle\projects\aro-landing\archive\aro-diagnosis.html`
- Create: `C:\Users\user\Desktop\aro-landing\diagnosis.html`

> 원본은 `circle/projects/aro-landing/archive/`에 백업으로 그대로 보존. 운영용은 새 레포(`Desktop/aro-landing/`) 루트의 `diagnosis.html` 단일 파일.

- [ ] **Step 1: 파일 복사**

```bash
cp "C:/Users/user/Desktop/circle/projects/aro-landing/archive/aro-diagnosis.html" "C:/Users/user/Desktop/aro-landing/diagnosis.html"
```

- [ ] **Step 2: 복사 확인**

```bash
ls -la "C:/Users/user/Desktop/aro-landing/diagnosis.html"
```

기대: 약 36KB 파일이 존재.

- [ ] **Step 3: 커밋**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add diagnosis.html
git -C "C:/Users/user/Desktop/aro-landing" commit -m "chore: copy aro-diagnosis.html from archive to root as diagnosis.html"
```

---

### Task 5: `diagnosis.html` — Anthropic 직접 호출 제거 + 백엔드 호출로 교체

**Files:**
- Modify: `C:\Users\user\Desktop\aro-landing\diagnosis.html`

목표: 클라이언트 측 `ANTHROPIC_API_KEY` 변수, 시스템 프롬프트, Anthropic 직접 호출, 데모 fallback을 모두 제거한다. 대신 `POST /api/diagnose`로 호출하고 결과를 받는다.

- [ ] **Step 1: 모델/키 상수 제거**

`diagnosis.html` 50~52번 줄 부근의 다음 두 줄을 **삭제**:

```javascript
const ANTHROPIC_API_KEY = ""; // 비우면 데모 모드. 실제 API 연결 시 sk-ant-... 입력.
const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
```

- [ ] **Step 2: 시스템 프롬프트 통째 제거**

`const systemPrompt = ` 로 시작해 큰 백틱 문자열로 끝나는 블록 전체(약 54~139번 줄)를 **삭제**. 이 프롬프트는 `api/diagnose.js`로 이미 옮겨놓았기 때문에 클라이언트에는 둘 필요 없음.

- [ ] **Step 3: 파일 상단 안내 주석 정리**

35~42번 줄의 다음 주석을 다음 내용으로 **교체**:

```html
<!--
  ============================================================
  설정 · 데모 전 확인
  ============================================================
  이 페이지는 백엔드 함수 /api/diagnose 와 /api/lead 를 호출합니다.
  API 키는 Vercel 환경변수에 등록되어 있으며, 클라이언트에는 노출되지 않습니다.
  Vercel 환경변수: ANTHROPIC_API_KEY, RESEND_API_KEY,
  TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
-->
```

- [ ] **Step 4: `runDiagnosis` 함수의 본문을 다음으로 교체**

기존 216~281번 줄의 `runDiagnosis` 함수를 통째로 다음으로 **교체**:

```javascript
async function runDiagnosis() {
  if (!formData.jobTarget || !formData.situation || !formData.resume) {
    setError("필수 항목을 모두 입력해주세요.");
    return;
  }
  if (formData.resume.length < 50) {
    setError("이력서 본문은 50자 이상 입력해주세요.");
    return;
  }
  if (!consent) {
    setError("개인정보 처리에 동의해야 진단을 시작할 수 있습니다.");
    return;
  }
  if (!turnstileToken) {
    setError("봇 검증을 완료해주세요.");
    return;
  }
  setError(null);
  setStep("loading");

  try {
    const response = await fetch("/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobTarget: formData.jobTarget,
        situation: formData.situation,
        resume: formData.resume,
        rejection: formData.rejection,
        turnstileToken,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data?.error || "일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setStep("input");
      return;
    }
    setResult(data.result);
    setStep("result");
  } catch (err) {
    console.error(err);
    setError("네트워크 오류입니다. 잠시 후 다시 시도해주세요.");
    setStep("input");
  }
}
```

> `consent`, `turnstileToken` 두 state는 다음 Step에서 추가됨.

- [ ] **Step 5: 컴포넌트 내부에 새 state 두 개 추가**

`function DiagnosisPage() {` 바로 안쪽, `const [error, setError] = useState(null);` 다음 줄에 추가:

```javascript
const [consent, setConsent] = useState(false);
const [turnstileToken, setTurnstileToken] = useState(null);
```

- [ ] **Step 6: 검증 (수동)**

브라우저에서 임시로 `diagnosis.html`을 열어 React 컴파일 에러나 white screen이 없는지 확인. (이 시점에는 `consent`/`turnstileToken`을 폼에서 아직 사용하지 않으므로 동작은 미완.)

```bash
# Windows에서 직접 열기
start "" "C:/Users/user/Desktop/aro-landing/diagnosis.html"
```

- [ ] **Step 7: 커밋**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add diagnosis.html
git -C "C:/Users/user/Desktop/aro-landing" commit -m "refactor(diagnosis): replace direct Anthropic call with /api/diagnose backend call"
```

---

### Task 6: `diagnosis.html` — 동의 체크박스 + Turnstile 위젯 + 결과 후 신청 폼

**Files:**
- Modify: `C:\Users\user\Desktop\aro-landing\diagnosis.html`

UI 3가지 추가: (a) 입력 폼에 동의 체크박스/처리방침 문구, (b) "진단 시작" 버튼 위에 Turnstile 위젯, (c) 결과 화면 하단에 "전문가 상담 신청" 폼.

- [ ] **Step 1: `<head>` 안에 Turnstile 스크립트 + Site Key 메타 추가**

`<title>` 직후에 추가:

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<meta name="turnstile-site-key" id="turnstile-site-key" content="__TURNSTILE_SITE_KEY__">
```

> ⚠️ **빌드 도구가 없으므로 Vercel 배포 시 환경변수가 자동 치환되지 않는다.** 두 가지 옵션:
> - **옵션 A (선택, 단순)**: 위 `content="__TURNSTILE_SITE_KEY__"` 자리에 **실제 Site Key 값을 직접 적는다**. Site Key는 공개되어도 안전한 종류라 Git에 들어가도 문제 없음. (Cloudflare 공식 권장)
> - **옵션 B**: Vercel Edge Middleware로 런타임 치환 — 복잡함. 이번 플랜은 옵션 A로 간다.
>
> → **이 단계 실행 시: `__TURNSTILE_SITE_KEY__` 자리에 Cloudflare에서 받은 Site Key를 직접 붙여넣음.** (예: `0x4AAAAAAA...`)

- [ ] **Step 2: 입력 폼에 동의 체크박스 추가**

`runDiagnosis` 호출 버튼 (`onClick={runDiagnosis}`이 있는 부분, 약 437번 줄 근처) **바로 위에** 다음 JSX를 추가:

```jsx
<div className="mt-6 mb-4">
  <div
    className="cf-turnstile"
    data-sitekey={document.getElementById("turnstile-site-key")?.content}
    data-callback={(token) => setTurnstileToken(token)}
    data-expired-callback={() => setTurnstileToken(null)}
    data-error-callback={() => setTurnstileToken(null)}
  />
</div>

<label className="flex items-start gap-2 mb-4 text-sm text-neutral-700 leading-relaxed">
  <input
    type="checkbox"
    checked={consent}
    onChange={(e) => setConsent(e.target.checked)}
    className="mt-1"
  />
  <span>
    <b>(필수)</b> 입력한 정보가 AI 진단 처리에 사용되며,
    '전문가 상담 신청' 시 입력 내용이 운영자에게 전달됨에 동의합니다.<br />
    <span className="text-neutral-500 text-xs">
      · 보관 기간: 신청 후 6개월 · 문의/삭제: <a href="mailto:naminimiya@gmail.com" className="underline">naminimiya@gmail.com</a>
    </span>
  </span>
</label>
```

> ⚠️ Turnstile 위젯은 React JSX의 `data-callback` 함수 props로 직접 함수를 넘길 수 없는 환경이 있을 수 있다. 작동 안 하면 다음 Step의 useEffect 패턴으로 교체.

- [ ] **Step 3: Turnstile 콜백 fallback (필요 시)**

만약 Step 2의 `data-callback={...}` 함수 props가 React에서 인식되지 않으면, 컴포넌트 안 useState 다음에 `useEffect`로 전역 콜백을 등록:

```javascript
React.useEffect(() => {
  window.__onTurnstile = (token) => setTurnstileToken(token);
  window.__onTurnstileExpired = () => setTurnstileToken(null);
  return () => {
    delete window.__onTurnstile;
    delete window.__onTurnstileExpired;
  };
}, []);
```

그리고 위젯 JSX를 다음으로 변경:

```jsx
<div
  className="cf-turnstile"
  data-sitekey={document.getElementById("turnstile-site-key")?.content}
  data-callback="__onTurnstile"
  data-expired-callback="__onTurnstileExpired"
/>
```

- [ ] **Step 4: 진단 시작 버튼 disabled 조건 추가**

`onClick={runDiagnosis}` 가 있는 버튼에 `disabled={!consent || !turnstileToken}` 속성과 disabled 시 회색 표시 클래스를 추가:

```jsx
<button
  onClick={runDiagnosis}
  disabled={!consent || !turnstileToken}
  className="... disabled:opacity-50 disabled:cursor-not-allowed"
>
  진단 시작
</button>
```

> 기존 className은 유지하고 `disabled:opacity-50 disabled:cursor-not-allowed`만 뒤에 덧붙이는 것.

- [ ] **Step 5: 결과 화면 하단에 "전문가 상담 신청" 폼 추가**

결과 컴포넌트의 마지막 닫히는 div 직전에 다음 컴포넌트를 추가하고 import:

```jsx
function ConsultRequestForm({ result }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [status, setStatus] = React.useState("idle"); // idle | sending | sent | error
  const [errMsg, setErrMsg] = React.useState("");

  async function submit() {
    setErrMsg("");
    if (!name.trim() || !email.trim()) {
      setErrMsg("이름과 이메일을 입력해주세요.");
      return;
    }
    if (!agree) {
      setErrMsg("개인정보 처리에 동의해야 신청할 수 있습니다.");
      return;
    }
    setStatus("sending");
    try {
      const r = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), consent: true, diagnosis: result }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErrMsg(data?.error || "전송에 실패했습니다. 잠시 후 다시 시도해주세요.");
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch (e) {
      setErrMsg("네트워크 오류입니다. 잠시 후 다시 시도해주세요.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="mt-12 p-8 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
        <p className="text-emerald-900 font-semibold">잘 접수되었습니다.</p>
        <p className="text-emerald-700 text-sm mt-2">운영자가 확인 후 회신드립니다. (영업일 기준 1~2일)</p>
      </div>
    );
  }

  return (
    <div className="mt-12 p-8 bg-neutral-50 border border-neutral-200 rounded-lg">
      <h3 className="text-xl font-bold mb-2">전문가 상담 신청</h3>
      <p className="text-sm text-neutral-600 mb-6">
        진단 결과를 바탕으로 한 1:1 상담을 신청합니다. 위 진단 결과가 운영자에게 함께 전달됩니다.
      </p>
      <div className="grid gap-3">
        <input
          type="text"
          placeholder="이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-neutral-300 rounded px-3 py-2"
        />
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border border-neutral-300 rounded px-3 py-2"
        />
        <label className="flex items-start gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-1"
          />
          <span>
            <b>(필수)</b> 위 이름·이메일과 진단 결과가 운영자에게 전달됨에 동의합니다.
            보관 기간 6개월. 문의/삭제: <a href="mailto:naminimiya@gmail.com" className="underline">naminimiya@gmail.com</a>
          </span>
        </label>
        {errMsg && <p className="text-red-600 text-sm">{errMsg}</p>}
        <button
          onClick={submit}
          disabled={status === "sending" || !agree}
          className="bg-neutral-900 text-white py-3 rounded font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "sending" ? "전송 중..." : "상담 신청"}
        </button>
      </div>
    </div>
  );
}
```

그리고 결과 화면(현재 `step === "result"` 분기 내부)에서 `<ConsultRequestForm result={result} />`을 결과 카드 하단에 렌더:

```jsx
{step === "result" && (
  <>
    {/* 기존 결과 표시 영역 */}
    <ConsultRequestForm result={result} />
  </>
)}
```

- [ ] **Step 6: 검증 (수동, 로컬에서 vercel dev 또는 미리보기 배포)**

```bash
# 권장: 미리보기 배포로 검증 (로컬 vercel dev는 Step 옵션)
git -C "C:/Users/user/Desktop/aro-landing" add diagnosis.html
git -C "C:/Users/user/Desktop/aro-landing" commit -m "feat(diagnosis): add consent checkbox, Turnstile widget, and consult request form"
git -C "C:/Users/user/Desktop/aro-landing" push
```

기대 결과:
- Vercel preview URL 생성 (대시보드의 Deployments 탭 또는 PR이 있다면 PR 코멘트에 표시)
- 그 URL의 `/diagnosis` 접속 → Turnstile 위젯이 보이고 동의 체크박스가 보임
- 체크 + 위젯 통과 + 입력 후 "진단 시작" 클릭 → 결과 표시
- 결과 화면 아래 "전문가 상담 신청" 폼이 보임 → 입력 후 "상담 신청" → "잘 접수되었습니다" + naminimiya@gmail.com에 알림 메일 도착

> 만약 환경변수 4개가 아직 등록되지 않았다면 이 검증은 다음 단계(Phase 4)에서 수행.

---

## Phase 3 — 랜딩페이지 CTA 연결

### Task 7: `index.html` — CTA 4곳을 `/diagnosis`로 교체

**Files:**
- Modify: `C:\Users\user\Desktop\aro-landing\index.html`

기존 `aro-diagnosis.html`로 가던 4개 링크를 `/diagnosis`로 바꾼다. (사용자가 "3곳"이라고 말씀하셨지만 nav 우상단 CTA까지 합쳐 4곳 발견됨.)

- [ ] **Step 1: 4곳 일괄 교체**

`href="aro-diagnosis.html"` 을 `href="/diagnosis"` 로 모두 치환. 정확한 위치는 다음 4줄:

- 336번 줄: nav 우상단 CTA (`무료 AI 진단`)
- 354번 줄: hero 메인 CTA (`지금 바로 AI 진단 시작`)
- 440번 줄: AI 진단 섹션 안 CTA (`지금 AI 진단 받기`)
- 701번 줄: 페이지 하단 final CTA (`지금 AI 진단 시작`)

> Edit 도구의 `replace_all` 모드를 사용하면 한 번에 처리됨. 단, `aro-diagnosis.html` 문자열이 다른 맥락(주석/텍스트)에도 있으면 의도치 않은 변경이 될 수 있으므로 grep으로 먼저 확인.

```bash
# 변경 전 확인
grep -n 'aro-diagnosis\.html' "C:/Users/user/Desktop/aro-landing/index.html"
```

기대: 정확히 4줄만 출력.

- [ ] **Step 2: 검증**

```bash
# 변경 후 확인 — 0건이어야 함
grep -n 'aro-diagnosis\.html' "C:/Users/user/Desktop/aro-landing/index.html"

# /diagnosis 링크 4개 확인
grep -n 'href="/diagnosis"' "C:/Users/user/Desktop/aro-landing/index.html"
```

- [ ] **Step 3: 커밋**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add index.html
git -C "C:/Users/user/Desktop/aro-landing" commit -m "feat(landing): point all 4 CTAs to /diagnosis"
```

---

## Phase 4 — 배포 + 종단 검증

### Task 8: 푸시 + 배포 + 환경변수 등록 확인

**누가:** Claude(push) + 사용자(환경변수 등록 확인)

- [ ] **Step 1: 모든 변경 푸시**

```bash
git -C "C:/Users/user/Desktop/aro-landing" push
```

→ Vercel이 자동으로 main 브랜치를 운영 환경에 배포.

- [ ] **Step 2: 사용자가 Vercel 환경변수 4개 등록 확인**

Vercel → 프로젝트 → Settings → Environment Variables에 4개 모두 등록됐는지 사용자가 직접 확인:

- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

- [ ] **Step 3: 환경변수 등록 후 재배포 (필요 시)**

만약 환경변수를 푸시 이후에 추가했다면 Vercel → Deployments → 최신 배포의 "..." 메뉴 → **Redeploy** 클릭.

---

### Task 9: 종단(end-to-end) 시나리오 테스트

**누가:** 사용자(검증). Claude는 콘솔 로그 분석 지원 가능.

운영 URL(예: `https://aro-landing.vercel.app/diagnosis`)에서 한 사이클 끝까지 돌려본다.

- [ ] **Step 1: 랜딩페이지 → 진단 페이지 이동 확인**

`https://aro-landing.vercel.app/` 접속 → CTA 4곳 중 아무거나 클릭 → `/diagnosis`로 이동되는지 확인.

- [ ] **Step 2: 진단 시작 흐름**

진단 페이지에서:
1. 4필드 입력 (목표 직무 / 상황 / 이력서 본문 50자 이상 / 탈락 사유)
2. Turnstile 위젯 통과
3. 동의 체크박스 ON
4. "진단 시작" 버튼 활성화 확인 → 클릭
5. 로딩 후 진단 결과 정상 표시 확인

기대: 결과 카드의 evidence에 이름/회사명 등 식별정보가 보이지 않음(시스템 프롬프트 마스킹 효과).

- [ ] **Step 3: 상담 신청 흐름**

결과 화면 하단:
1. 이름·이메일 입력
2. 동의 체크박스 ON
3. "상담 신청" 클릭
4. "잘 접수되었습니다" 메시지 확인

- [ ] **Step 4: 운영자 메일 도착 확인**

`naminimiya@gmail.com` 메일함 확인 (스팸함 포함). 다음 메일이 도착해야 함:

- 발신자: `ARO 진단 신청 <onboarding@resend.dev>`
- 제목: `[ARO 진단 신청] [입력한 이름] / [시각]`
- 본문: 신청 시각·이름·이메일 표 + 진단 결과 JSON 전체

- [ ] **Step 5: Anthropic 사용량 확인**

https://console.anthropic.com → Usage → 진단 1회 호출이 기록되었는지 확인. 요금이 약 $0.03~0.05 차감.

- [ ] **Step 6: 에러 케이스 빠르게 한 번**

빈 필드로 "진단 시작" 클릭 → 에러 메시지 표시 확인. 동의 체크 안 한 채로 버튼 클릭 → 비활성화 확인.

---

## Phase 5 — 사후 정리 (선택)

### Task 10: README 업데이트 (선택)

**Files:**
- Modify: `C:\Users\user\Desktop\aro-landing\README.md`

레포 README에 새 구조와 운영 방식을 한 단락으로 정리. (사용자가 원하지 않으면 건너뜀.)

- [ ] **Step 1: README에 운영 안내 추가**

```markdown
## 운영 메모

- 진단 페이지: `/diagnosis`
- 진단 호출: `POST /api/diagnose` (Anthropic Claude)
- 상담 신청 알림: `POST /api/lead` (Resend → naminimiya@gmail.com)
- 봇 차단: Cloudflare Turnstile
- 환경변수: ANTHROPIC_API_KEY, RESEND_API_KEY, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY

자세한 설계는 `DESIGN.md` 참고.
```

- [ ] **Step 2: 커밋 + 푸시**

```bash
git -C "C:/Users/user/Desktop/aro-landing" add README.md
git -C "C:/Users/user/Desktop/aro-landing" commit -m "docs: add operational notes to README"
git -C "C:/Users/user/Desktop/aro-landing" push
```

---

## 자가 검토 (Spec ↔ Plan 매핑)

| DESIGN.md 결정사항 | 구현 위치 |
|---|---|
| 1. 같은 사이트의 다른 경로 (`/diagnosis`) | Task 4, 7 |
| 2. 결과 후 "전문가 상담 신청" 폼 | Task 6 Step 5 |
| 3. C-1 / Resend 이메일 알림 | Task 3 |
| 4. naminimiya@gmail.com | Task 3 (`OPERATOR_EMAIL`) |
| 5. (a) 결과 전체 + 안전장치 1+2 | Task 3 (메일 본문에 진단 결과 JSON 전체) |
| 6. 안전장치 1: 식별정보 마스킹 시스템 프롬프트 | Task 2 (SYSTEM_PROMPT 안 evidence 작성 규칙) |
| 7. 안전장치 2: 동의 체크박스 + 처리방침 | Task 6 Step 2 (입력 폼) + Step 5 (신청 폼 안) |
| 8. Anthropic prepaid + Turnstile | Task 0(Anthropic) + Task 6 Step 1~3(Turnstile) |
| 9. 모델: claude-sonnet-4-20250514 | Task 2 (`ANTHROPIC_MODEL`) |
| 환경변수 4개 | Task 0 Step 4, Task 8 |

빈 곳 없음.

---

## 변경 이력

- 2026-04-29: 플랜 초안 생성. brainstorming → writing-plans 흐름 통과.
