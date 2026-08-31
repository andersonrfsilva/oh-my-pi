import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
});

function approvalCtx(approvalMode: "always-ask" | "write" | "yolo" | null): SegmentContext {
	return { approvalMode } as unknown as SegmentContext;
}

describe("approval status-line segment", () => {
	it("renders visibly for yolo", () => {
		const result = renderSegment("approval", approvalCtx("yolo"));
		expect(result.visible).toBe(true);
		expect(stripVTControlCharacters(result.content)).toContain("yolo");
	});

	it("renders visibly for write", () => {
		const result = renderSegment("approval", approvalCtx("write"));
		expect(result.visible).toBe(true);
		expect(stripVTControlCharacters(result.content)).toContain("write");
	});

	it("hides for always-ask", () => {
		const result = renderSegment("approval", approvalCtx("always-ask"));
		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("hides for null (unresolved)", () => {
		const result = renderSegment("approval", approvalCtx(null));
		expect(result.visible).toBe(false);
		expect(result.content).toBe("");
	});

	it("colors yolo more loudly than write", () => {
		const yolo = renderSegment("approval", approvalCtx("yolo"));
		const write = renderSegment("approval", approvalCtx("write"));
		expect(yolo.content).not.toEqual(write.content);
		expect(yolo.content).toContain(theme.getFgAnsi("error"));
	});

	it("reads the live setting through the component rather than a constructor snapshot", () => {
		settings.override("tools.approvalMode", "always-ask");
		const session = {
			state: { messages: [], model: { id: "test-model", contextWindow: 100_000 } },
			messages: [],
			model: { id: "test-model", name: "Test Model", contextWindow: 100_000 },
			systemPrompt: [],
			agent: { state: { tools: [] } },
			skills: [],
			isStreaming: false,
			isAutoThinking: false,
			autoResolvedThinkingLevel: () => undefined,
			isFastModeActive: () => false,
			isAdvisorActive: () => false,
			getAdvisorStatusOverview: () => ({ configured: false, advisors: [] }),
			getAsyncJobSnapshot: () => ({ running: [] }),
			modelRegistry: { isUsingOAuth: () => false },
			sessionManager: {
				getSessionName: () => "Approval Session",
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
			getContextUsage: () => undefined,
		} as unknown as ConstructorParameters<typeof StatusLineComponent>[0];

		const component = new StatusLineComponent(session);
		component.updateSettings({
			preset: "custom",
			leftSegments: ["approval"],
			rightSegments: [],
			separator: "none",
			sessionAccent: false,
		});

		const strict = stripVTControlCharacters(component.getTopBorder(80).content);
		expect(strict).not.toContain("yolo");
		expect(strict).not.toContain("write");

		settings.override("tools.approvalMode", "yolo");
		component.invalidate();

		const relaxed = stripVTControlCharacters(component.getTopBorder(80).content);
		expect(relaxed).toContain("yolo");
	});
});
