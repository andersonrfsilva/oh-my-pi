/**
 * The `git` status-line segment shows upstream divergence (`↑N` unpushed,
 * `↓N` behind) beside the branch. These cover the render shapes, the
 * `showUpstream` opt-out, the "unpushed is not dirty" color contract, and the
 * component-level cache that keeps the ref walks off the render path.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { StatusLineSettings } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { StatusLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/status-line";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type {
	SegmentContext,
	StatusLineSegmentOptions,
} from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { VcsGitRepo, VcsGitRepoInfo, VcsHeadState, VcsRepo } from "@oh-my-pi/pi-natives";
import * as vcs from "@oh-my-pi/pi-natives/vcs";
import { getProjectDir, setProjectDir } from "@oh-my-pi/pi-utils";

type GitStatus = { staged: number; unstaged: number; untracked: number };
type Upstream = { ahead: number; behind: number };

const CLEAN: GitStatus = { staged: 0, unstaged: 0, untracked: 0 };
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

function gitCtx(
	status: GitStatus | null,
	upstream: Upstream | null,
	options?: StatusLineSegmentOptions["git"],
): SegmentContext {
	return {
		options: { git: options ?? {} },
		git: { branch: "main", status, pr: null, upstream },
	} as unknown as SegmentContext;
}

/** Leading ANSI run the git segment wraps its whole content in. */
function leadingAnsi(content: string): string {
	return /^(?:\x1b\[[0-9;]*m)+/.exec(content)?.[0] ?? "";
}

describe("git status-line segment renders upstream divergence", () => {
	it("renders ↑N alone when the branch is only ahead", () => {
		const rendered = renderSegment("git", gitCtx(CLEAN, { ahead: 3, behind: 0 }));
		const content = stripVTControlCharacters(rendered.content);

		expect(rendered.visible).toBe(true);
		expect(content).toContain("↑3");
		expect(content).not.toContain("↓");
	});

	it("renders ahead before behind when the branch has diverged", () => {
		const rendered = renderSegment("git", gitCtx(CLEAN, { ahead: 3, behind: 2 }));
		const content = stripVTControlCharacters(rendered.content);

		expect(content).toContain("↑3");
		expect(content).toContain("↓2");
		expect(content.indexOf("↑3")).toBeLessThan(content.indexOf("↓2"));
	});

	it("renders no counters when the branch is in sync", () => {
		const rendered = renderSegment("git", gitCtx(CLEAN, { ahead: 0, behind: 0 }));
		const content = stripVTControlCharacters(rendered.content);

		expect(content).toContain("main");
		expect(content).not.toContain("↑");
		expect(content).not.toContain("↓");
	});

	it("suppresses the counters under showUpstream: false while keeping the branch", () => {
		const rendered = renderSegment("git", gitCtx(CLEAN, { ahead: 3, behind: 2 }, { showUpstream: false }));
		const content = stripVTControlCharacters(rendered.content);

		expect(rendered.visible).toBe(true);
		expect(content).toContain("main");
		expect(content).not.toContain("↑");
		expect(content).not.toContain("↓");
	});

	it("keeps the clean branch color when a clean tree has unpushed commits", () => {
		const withUnpushed = renderSegment("git", gitCtx(CLEAN, { ahead: 2, behind: 0 })).content;
		const withoutUpstream = renderSegment("git", gitCtx(CLEAN, null)).content;
		const dirty = renderSegment("git", gitCtx({ staged: 0, unstaged: 1, untracked: 0 }, null)).content;

		expect(leadingAnsi(withUnpushed)).toBe(leadingAnsi(withoutUpstream));
		// Guard the guard: the clean/dirty colors really do differ, so the
		// equality above is not vacuously true.
		expect(leadingAnsi(dirty)).not.toBe(leadingAnsi(withoutUpstream));
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

const gitControls = {
	defaultBranch: vi.fn(async (_signal?: AbortSignal): Promise<string | null> => null),
	head: vi.fn(async (_signal?: AbortSignal): Promise<VcsHeadState | null> => fakeRefHead),
	headSync: vi.fn((): VcsHeadState | null => fakeRefHead),
	statusSummary: vi.fn(async (_signal?: AbortSignal): Promise<GitStatus | null> => CLEAN),
	currentBranch: vi.fn(async (_signal?: AbortSignal): Promise<string | null> => "main"),
	configGet: vi.fn(async (_key: string, _signal?: AbortSignal): Promise<string | null> => null),
	refExists: vi.fn(async (_name: string, _signal?: AbortSignal): Promise<boolean> => true),
	revListRange: vi.fn(async (_base: string, _head: string, _signal?: AbortSignal): Promise<string[]> => []),
};

const fakeRepository = {
	defaultBranch: (signal?: AbortSignal) => gitControls.defaultBranch(signal),
	head: (signal?: AbortSignal) => gitControls.head(signal),
	headSync: () => gitControls.headSync(),
	linkedWorktree: () => null,
	statusSummary: (signal?: AbortSignal) => gitControls.statusSummary(signal),
	currentBranch: (signal?: AbortSignal) => gitControls.currentBranch(signal),
	configGet: (key: string, signal?: AbortSignal) => gitControls.configGet(key, signal),
	refExists: (name: string, signal?: AbortSignal) => gitControls.refExists(name, signal),
	revListRange: (base: string, head: string, signal?: AbortSignal) => gitControls.revListRange(base, head, signal),
} as unknown as VcsGitRepo;

const fakeVcsRepository = {
	kind: () => "git",
	asGit: () => fakeRepository,
	asJj: () => null,
	root: () => fakeRepoInfo.repoRoot,
	watchTarget: () => fakeRepoInfo.headPath,
	statusSummary: (signal?: AbortSignal) => fakeRepository.statusSummary(signal),
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
			getSessionName: () => "upstream test",
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

const gitSegmentSettings: StatusLineSettings = {
	preset: "custom",
	leftSegments: ["git"],
	rightSegments: ["session_name"],
	separator: "powerline-thin",
	sessionAccent: false,
	transparent: false,
};

beforeEach(() => {
	gitControls.defaultBranch.mockReset().mockResolvedValue(null);
	gitControls.head.mockReset().mockResolvedValue(fakeRefHead);
	gitControls.headSync.mockReset().mockReturnValue(fakeRefHead);
	gitControls.statusSummary.mockReset().mockResolvedValue(CLEAN);
	gitControls.currentBranch.mockReset().mockResolvedValue("main");
	gitControls.configGet.mockReset().mockResolvedValue(null);
	gitControls.refExists.mockReset().mockResolvedValue(true);
	gitControls.revListRange.mockReset().mockResolvedValue([]);
	vi.spyOn(vcs, "gitInfo").mockReturnValue(fakeRepoInfo);
	vi.spyOn(vcs, "git").mockReturnValue(fakeRepository);
	vi.spyOn(vcs, "repo").mockReturnValue(fakeVcsRepository);
});

/** Let the chained awaits inside the upstream resolve settle. */
async function flush(): Promise<void> {
	for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe("StatusLineComponent resolves upstream ahead/behind off the render path", () => {
	it("caches the resolved counters and does not re-walk refs within the TTL", async () => {
		gitControls.configGet.mockImplementation(async (key: string) =>
			key === "branch.main.remote" ? "origin" : "refs/heads/main",
		);
		gitControls.revListRange.mockImplementation(async (base: string) =>
			base === "refs/remotes/origin/main" ? ["a", "b"] : [],
		);

		const component = new StatusLineComponent(makeSession());
		component.updateSettings(gitSegmentSettings);
		component.watchBranch(() => {});

		// Cold paint: the resolve has not landed, so no counters yet.
		const cold = stripVTControlCharacters(component.getTopBorder(120).content);
		expect(cold).not.toContain("↑");

		await flush();
		const callsAfterResolve = gitControls.revListRange.mock.calls.length;
		expect(callsAfterResolve).toBe(2);

		const warm = stripVTControlCharacters(component.getTopBorder(120).content);
		expect(warm).toContain("↑2");
		expect(warm).not.toContain("↓");

		// A second paint inside the TTL is served from cache.
		component.getTopBorder(120);
		await flush();
		expect(gitControls.revListRange.mock.calls).toHaveLength(callsAfterResolve);

		component.dispose();
	});

	it("never walks refs when the branch has no configured upstream", async () => {
		gitControls.configGet.mockResolvedValue(null);

		const component = new StatusLineComponent(makeSession());
		component.updateSettings(gitSegmentSettings);
		component.watchBranch(() => {});

		component.getTopBorder(120);
		await flush();

		expect(gitControls.configGet).toHaveBeenCalled();
		expect(gitControls.revListRange).not.toHaveBeenCalled();
		expect(gitControls.refExists).not.toHaveBeenCalled();

		const rendered = stripVTControlCharacters(component.getTopBorder(120).content);
		expect(rendered).toContain("main");
		expect(rendered).not.toContain("↑");
		expect(rendered).not.toContain("↓");

		component.dispose();
	});
});
