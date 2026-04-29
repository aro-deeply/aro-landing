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
