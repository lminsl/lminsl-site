// Stand-in for the Anthropic client: deterministic "Korean" so the pipeline can run offline.
export function fakeClient({ reviewIssues = [] } = {}) {
  const calls = [];
  const reply = (obj) => ({
    model: "fake", stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
    content: [{ type: "text", text: JSON.stringify(obj) }],
  });
  return {
    calls,
    beta: {
      messages: {
        stream(params) {
          calls.push(params);
          const user = params.messages[0].content;
          const schema = params.output_config.format.schema;
          let out;
          if (schema.properties.labels) {
            const items = JSON.parse(user.slice(user.indexOf("Items:") + "Items:".length));
            const m = user.match(/new section labels and return them in "labels": (\[.*\])/);
            const newLabels = m ? JSON.parse(m[1]) : [];
            out = {
              items: items.map((u) => ({
                id: u.id,
                headline: `한국어 제목 ${u.headline.slice(0, 20)}`,
                summary: u.summary ? `한국어 요약이다 ${u.summary.length}` : "",
                byline: u.byline ? `기자(${u.byline})` : "",
                photo: !u.photo_alt ? "none" : /tanker/i.test(u.photo_alt) ? "confident" : "unsure",
              })),
              labels: newLabels.map((en) => ({ en, ko: `라벨 ${en}` })),
            };
          } else {
            out = { issues: reviewIssues.splice(0) };
          }
          return { finalMessage: async () => reply(out) };
        },
      },
    },
  };
}
