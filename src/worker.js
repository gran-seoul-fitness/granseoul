const VERIFY_PROMPT =
  "Look only at the actual physical objects photographed in this image. Does it show REAL gym exercise equipment " +
  "(an actual treadmill, exercise bike, bench press, dumbbells, cable machine, leg press, etc.), an exercise mat " +
  "(yoga mat or pilates mat) used for a workout, or a person actually exercising? Answer NO if this is a poster, " +
  "flyer, QR code, sign, screenshot, or any printed or digital material - even if it mentions fitness, health, or " +
  "a challenge in text. Answer with only one word, YES or NO. Do not add any explanation.";

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
    const [, , base64Data] = match;

    if (!env.AI) {
      // Workers AI 바인딩이 없으면 인증 자체를 막지 않음 (기능 도입 전과 동일하게 동작)
      return jsonResponse({ ok: true, reason: "no_ai_binding" });
    }

    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
    const imageArr = Array.from(bytes);
    let result;
    try {
      result = await env.AI.run(MODEL, { image: imageArr, prompt: VERIFY_PROMPT, max_tokens: 12 });
    } catch (e) {
      if (String(e).includes("must submit the prompt 'agree'")) {
        // Meta 라이선스에 이 계정이 아직 동의 안 한 상태 -> 한 번 자동으로 동의 처리 후 재시도
        await env.AI.run(MODEL, { prompt: "agree", max_tokens: 5 });
        result = await env.AI.run(MODEL, { image: imageArr, prompt: VERIFY_PROMPT, max_tokens: 12 });
      } else {
        throw e;
      }
    }

    const text = (result.description || result.response || "").trim().toUpperCase();
    if (!text) {
      // 모델이 명확한 답을 못 냈으면 판단을 보류하고 통과시킴
      return jsonResponse({ ok: true, reason: "empty_response" });
    }
    return jsonResponse({ ok: text.includes("YES"), reason: "checked", modelText: text.slice(0, 60) });
  } catch (e) {
    // 검증 과정 자체가 실패해도 사용자의 정상적인 인증 흐름을 막지 않음
    return jsonResponse({ ok: true, reason: "exception_fail_open", detail: String(e).slice(0, 200) });
  }
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json" },
  });
}
