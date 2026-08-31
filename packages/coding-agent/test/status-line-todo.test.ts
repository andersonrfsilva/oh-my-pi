import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type { SegmentContext, StatusLineSegmentId } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TodoPhase } from "@oh-my-pi/pi-coding-agent/tools/todo";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
});

function makeComponent(
	getTodoPhases: () => TodoPhase[],
	segments: { left: StatusLineSegmentId[]; right: StatusLineSegmentId[] },
): StatusLineComponent {
	const component = new StatusLineComponent({
		state: { messages: [], model: { id: "test-model", contextWindow: 1000 } },
		model: { id: "test-model", contextWindow: 1000 },
		sessionManager: {
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				orchestrationInput: 0,
				orchestrationOutput: 0,
				orchestrationCacheRead: 0,
				premiumRequests: 0,
				cost: 0,
			}),
		},
		fetchUsageReports: async () => [],
		modelRegistry: { authStorage: { getOAuthAccountIdentity: () => undefined } },
		getAsyncJobSnapshot: () => ({ running: [] }),
		getContextUsage: () => undefined,
		getTodoPhases,
	} as unknown as ConstructorParameters<typeof StatusLineComponent>[0]);
	component.updateSettings({
		preset: "custom",
		leftSegments: segments.left,
		rightSegments: segments.right,
		sessionAccent: false,
	});
	return component;
}

describe("todo status-line segment", () => {
	it("renders closed/total counts when the session has todos", () => {
		const result = renderSegment("todo", {
			todo: { closed: 4, total: 7, blocked: 0 },
		} as unknown as SegmentContext);

		expect(result.visible).toBe(true);
		expect(stripVTControlCharacters(result.content)).toContain("4/7");
	});

	it("hides itself when there is no todo snapshot", () => {
		const result = renderSegment("todo", { todo: null } as unknown as SegmentContext);

		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("counts abandoned tasks as closed through the component", () => {
		const phases: TodoPhase[] = [
			{
				name: "phase one",
				tasks: [
					{ content: "a", status: "completed" },
					{ content: "b", status: "completed" },
					{ content: "c", status: "abandoned" },
				],
			},
			{
				name: "phase two",
				tasks: [
					{ content: "d", status: "pending" },
					{ content: "e", status: "blocked" },
				],
			},
		];
		const component = makeComponent(() => phases, { left: ["todo"], right: [] });

		const content = stripVTControlCharacters(component.getTopBorder(200).content);

		expect(content).toContain("3/5");
	});

	it("never snapshots todos when no layout slot shows the segment", () => {
		let calls = 0;
		const component = makeComponent(
			() => {
				calls++;
				return [];
			},
			{ left: [], right: [] },
		);

		component.getTopBorder(200);

		expect(calls).toBe(0);
	});
});
