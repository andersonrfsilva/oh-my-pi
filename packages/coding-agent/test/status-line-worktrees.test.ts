/**
 * The `worktrees` status-line segment shows how many worktrees the active
 * repository has. It stays hidden for a plain checkout (count <= 1) and for
 * an unresolved (null) count, and it resolves the count off the render path
 * behind the same single-flight, cwd-keyed, TTL'd cache used by the git
 * segment's upstream counters.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { StatusLineSettings } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { VcsGitRepo, VcsGitRepoInfo, VcsHeadState, VcsRepo, VcsWorktreeEntry } from "@oh-my-pi/pi-natives";
import * as vcs from "@oh-my-pi/pi-natives/vcs";
import { getProjectDir, setProjectDir } from "@oh-my-pi/pi-utils";

const originalProjectDir = getProjectDir();

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
	setProjectDir(originalProjectDir);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function worktreesCtx(worktreeCount: number | null): SegmentContext {
	return { worktreeCount } as unknown as SegmentContext;
}

describe("worktrees status-line segment", () => {
	it("renders the count when the repository has more than one worktree", () => {
		const rendered = renderSegment("worktrees", worktreesCtx(4));
		const content = stripVTControlCharacters(rendered.content);

		expect(rendered.visible).toBe(true);
		expect(content).toContain("4");
	});

	it("hides for a plain checkout (count 1)", () => {
		const rendered = renderSegment("worktrees", worktreesCtx(1));

		expect(rendered.visible).toBe(false);
		expect(rendered.content).toBe("");
	});

	it("hides when the count has not resolved yet (null)", () => {
		const rendered = renderSegment("worktrees", worktreesCtx(null));

		expect(rendered.visible).toBe(false);
		expect(rendered.content).toBe("");
	});
});

const fakeRefHead: VcsHeadState = {
	kind: "ref",
	branch: "main",
	refName: "refs/heads/main",
	commit: undefined,
};
const fakeRepoInfo: VcsGitRepoInfo = {
	commonDir: "/fake/.git",
	gitDir: "/fake/.git",
	gitEntryPath: "/fake/.git",
	headPath: "/fake/.git/HEAD",
	repoRoot: "/fake",
	isReftable: false,
};

const worktreeControls = {
	worktrees: vi.fn(
		async (_signal?: AbortSignal): Promise<VcsWorktreeEntry[]> => [
			{ path: "/a", detached: false },
			{ path: "/b", detached: false },
		],
	),
};

const fakeRepository = {
	defaultBranch: async (_signal?: AbortSignal): Promise<string | null> => null,
	head: async (_signal?: AbortSignal): Promise<VcsHeadState | null> => fakeRefHead,
	headSync: (): VcsHeadState | null => fakeRefHead,
	linkedWorktree: () => null,
	statusSummary: async (_signal?: AbortSignal) => ({ staged: 0, unstaged: 0, untracked: 0 }),
	worktrees: (signal?: AbortSignal) => worktreeControls.worktrees(signal),
} as unknown as VcsGitRepo;

const fakeGitVcsRepository = {
	kind: () => "git",
	asGit: () => fakeRepository,
	asJj: () => null,
	root: () => fakeRepoInfo.repoRoot,
	watchTarget: () => fakeRepoInfo.headPath,
	statusSummary: (signal?: AbortSignal) => fakeRepository.statusSummary(signal),
} as unknown as VcsRepo;

const fakeJjVcsRepository = {
	kind: () => "jj",
	asGit: () => null,
	asJj: () => null,
	root: () => "/fake/jj/root",
	watchTarget: () => "/fake/jj/root/.jj/repo/op_heads/heads",
	statusSummary: async () => ({ staged: 0, unstaged: 0, untracked: 0 }),
	label: async () => null,
} as unknown as VcsRepo;

function makeSession() {
	return {
		state: { messages: [], model: undefined },
		messages: [],
		model: undefined,
		systemPrompt: [],
		agent: { state: { tools: [] } },
		skills: [],
		isStreaming: false,
		isAutoThinking: false,
		autoResolvedThinkingLevel: () => undefined,
		isFastModeActive: () => false,
		isFastModeEnabled: () => false,
		getGoalModeState: () => null,
		getAsyncJobSnapshot: () => ({ running: [] }),
		modelRegistry: { isUsingOAuth: () => false },
		sessionManager: {
			getSessionName: () => "worktrees test",
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				premiumRequests: 0,
				cost: 0,
			}),
		},
	} as unknown as ConstructorParameters<typeof StatusLineComponent>[0];
}

const worktreesSegmentSettings: StatusLineSettings = {
	preset: "custom",
	leftSegments: ["worktrees"],
	rightSegments: [],
	separator: "powerline-thin",
	sessionAccent: false,
	transparent: false,
};

const noSegmentSettings: StatusLineSettings = {
	preset: "custom",
	leftSegments: [],
	rightSegments: [],
	separator: "powerline-thin",
	sessionAccent: false,
	transparent: false,
};

beforeEach(() => {
	worktreeControls.worktrees.mockReset().mockResolvedValue([
		{ path: "/a", detached: false },
		{ path: "/b", detached: false },
	]);
	vi.spyOn(vcs, "gitInfo").mockReturnValue(fakeRepoInfo);
	vi.spyOn(vcs, "git").mockReturnValue(fakeRepository);
	vi.spyOn(vcs, "repo").mockReturnValue(fakeGitVcsRepository);
});

/** Let the chained awaits inside the worktree-count resolve settle. */
async function flush(): Promise<void> {
	for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("StatusLineComponent resolves the worktree count off the render path", () => {
	it("hides on the cold paint and shows the resolved count after the async listing lands", async () => {
		const component = new StatusLineComponent(makeSession());
		component.updateSettings(worktreesSegmentSettings);
		component.watchBranch(() => {});

		const cold = stripVTControlCharacters(component.getTopBorder(120).content);
		expect(cold).not.toContain("2");

		await flush();

		const warm = stripVTControlCharacters(component.getTopBorder(120).content);
		expect(warm).toContain("2");

		component.dispose();
	});

	it("does not re-list worktrees on a second render within the TTL", async () => {
		const component = new StatusLineComponent(makeSession());
		component.updateSettings(worktreesSegmentSettings);
		component.watchBranch(() => {});

		component.getTopBorder(120);
		await flush();
		expect(worktreeControls.worktrees).toHaveBeenCalledTimes(1);

		component.getTopBorder(120);
		await flush();
		expect(worktreeControls.worktrees).toHaveBeenCalledTimes(1);

		component.dispose();
	});

	it("never lists worktrees when no worktrees segment is configured", async () => {
		const component = new StatusLineComponent(makeSession());
		component.updateSettings(noSegmentSettings);
		component.watchBranch(() => {});

		component.getTopBorder(120);
		await flush();

		expect(worktreeControls.worktrees).not.toHaveBeenCalled();

		component.dispose();
	});

	it("never lists worktrees for a jj repository and keeps the segment hidden", async () => {
		vi.spyOn(vcs, "repo").mockReturnValue(fakeJjVcsRepository);

		const component = new StatusLineComponent(makeSession());
		component.updateSettings(worktreesSegmentSettings);
		component.watchBranch(() => {});

		const rendered = stripVTControlCharacters(component.getTopBorder(120).content);
		await flush();

		expect(worktreeControls.worktrees).not.toHaveBeenCalled();
		expect(rendered).not.toContain("2");

		component.dispose();
	});
});
