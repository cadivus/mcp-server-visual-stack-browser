import type { ToolResponse } from "../types.js";
import { ExecuteJsSchema } from "../schemas.js";
import { getDriver } from "../session.js";

export const executeJavascriptTool = {
  name: "execute_javascript",
  description:
    "Execute JavaScript in the current browser page. " +
    "The return value of the script is returned as text. " +
    "Set async to true to write code that uses await.",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Session ID returned by start_browser.",
      },
      script: {
        type: "string",
        description: "JavaScript source to run. Use `return` to produce a value.",
      },
      async: {
        type: "boolean",
        description:
          "Wrap the script in an async function (enables await). Default: false.",
      },
      args: {
        type: "array",
        items: {},
        description:
          "Arguments available inside the script as the arguments array.",
      },
    },
    required: ["session_id", "script"],
    additionalProperties: false,
  },
};

export async function handleExecuteJavascript(args: unknown): Promise<ToolResponse> {
  const parsed = ExecuteJsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
    };
  }

  const { session_id, script, async: isAsync, args: scriptArgs } = parsed.data;
  const driver = getDriver(session_id);
  if (!driver) {
    return {
      isError: true,
      content: [{ type: "text", text: `No session found with ID: ${session_id}` }],
    };
  }

  try {
    let result: unknown;
    if (isAsync) {
      // Wrap in an async IIFE; Selenium's callback receives the resolved value
      const wrapped = `
        const __cb = arguments[arguments.length - 1];
        Promise.resolve()
          .then(async () => { ${script} })
          .then(
            (v) => __cb({ ok: true, value: v }),
            (e) => __cb({ ok: false, error: e instanceof Error ? e.message : String(e) })
          );
      `;
      const asyncResult = (await driver.executeAsyncScript(
        wrapped,
        ...(scriptArgs as unknown[])
      )) as { ok: boolean; value?: unknown; error?: string };
      if (!asyncResult.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Script error: ${asyncResult.error}` }],
        };
      }
      result = asyncResult.value;
    } else {
      result = await driver.executeScript(script, ...(scriptArgs as unknown[]));
    }

    const resultText =
      result === undefined || result === null
        ? String(result)
        : typeof result === "object"
        ? JSON.stringify(result, null, 2)
        : String(result);

    return { content: [{ type: "text", text: resultText }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Script execution failed: ${message}` }],
    };
  }
}
