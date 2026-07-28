const VERIFY_PROMPT =
  "이 사진에 헬스장 운동기구(러닝머신, 사이클, 벤치프레스, 덤벨, 케이블 머신, 레그프레스 등)나 운동/헬스 관련 장면이 보이나요? " +
  "다른 설명이나 이유는 절대 붙이지 말고, 오직 YES 또는 NO 라는 단어 하나로만 답하세요.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/verify-photo" && request.method === "POST") {
      return handleVerifyPhoto(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleVerifyPhoto(request, env) {
  try {
    const { image } = await request.json();
    const match = typeof image === "string" && image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
    if (!match) {
      return jsonResponse({ ok: false, reason: "invalid_image" });
    }
    const [, mimeType, base64Data] = match;

    if (!env.GEMINI_API_KEY) {
      // 키가 아직 설정 안 된 상태에서는 인증 자체를 막지 않음 (기능 도입 전과 동일하게 동작)
      return jsonResponse({ ok: true, reason: "no_api_key" });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: VERIFY_PROMPT },
                { inlineData: { mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 300 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text().catch(() => "");
      return jsonResponse({ ok: true, reason: "api_error_fail_open", status: geminiRes.status, detail: errBody.slice(0, 200) });
    }
    const data = await geminiRes.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toUpperCase();
    if (!text) {
      // 모델이 명확한 답을 못 냈으면(토큰 부족 등) 판단을 보류하고 통과시킴
      return jsonResponse({ ok: true, reason: "empty_response", finishReason: data.candidates?.[0]?.finishReason || null });
    }
    return jsonResponse({ ok: text.startsWith("YES"), reason: "checked", modelText: text.slice(0, 60) });
  } catch (e) {
    // 검증 과정 자체가 실패해도 사용자의 정상적인 인증 흐름을 막지 않음
    return jsonResponse({ ok: true, reason: "exception_fail_open" });
  }
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json" },
  });
}
