import test from "node:test";
import assert from "node:assert/strict";
import { clearUnusedRuntimeAgentSectionsForTest } from "../src/routes/generate.routes.js";

test("unused runtime agent section cleanup removes empty XML group wrappers", () => {
  const messages = [
    {
      content:
        "<agent_group>\n    __start__<knowledge_retrieval_agent>\n        __placeholder__\n    </knowledge_retrieval_agent>__end__\n</agent_group>",
    },
  ];

  clearUnusedRuntimeAgentSectionsForTest(messages, [
    ["knowledge-retrieval", { placeholder: "__placeholder__", start: "__start__", end: "__end__" }],
  ]);

  assert.deepEqual(messages, []);
});

test("removes empty XML group wrapper but preserves surrounding content", () => {
  const messages = [
    {
      content:
        "Before\n__start__<agent_group>\n    <knowledge_retrieval_agent>\n        __placeholder__\n    </knowledge_retrieval_agent>\n</agent_group>__end__\nAfter",
    },
  ];

  clearUnusedRuntimeAgentSectionsForTest(messages, [
    ["knowledge-retrieval", { placeholder: "__placeholder__", start: "__start__", end: "__end__" }],
  ]);

  assert.deepEqual(messages, [{ content: "Before\n\nAfter" }]);
});

test("unused runtime agent section cleanup removes empty Markdown group wrappers", () => {
  const messages = [
    {
      content: "# Agent Group\n__start__## Knowledge Retrieval Agent\n__placeholder____end__",
    },
  ];

  clearUnusedRuntimeAgentSectionsForTest(messages, [
    ["knowledge-retrieval", { placeholder: "__placeholder__", start: "__start__", end: "__end__" }],
  ]);

  assert.deepEqual(messages, []);
});

test("unused runtime agent section cleanup removes empty Markdown group wrappers but preserves surrounding content", () => {
  const messages = [
    {
      content: "Before\n__start__# Agent Group\n## Knowledge Retrieval Agent\n__placeholder____end__\nAfter",
    },
  ];

  clearUnusedRuntimeAgentSectionsForTest(messages, [
    ["knowledge-retrieval", { placeholder: "__placeholder__", start: "__start__", end: "__end__" }],
  ]);

  assert.deepEqual(messages, [{ content: "Before\n\nAfter" }]);
});
