import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { EditorWindow, MONO, SANS } from "../editor/EditorWindow";
import { colors } from "../editor/highlight";

const SCENES = {
  title: { from: 0, duration: 120 },
  bug: { from: 120, duration: 210 },
  oldHelper: { from: 330, duration: 150 },
  fix: { from: 480, duration: 300 },
  end: { from: 780, duration: 120 },
};

export const MONACO_DURATION = SCENES.end.from + SCENES.end.duration;

const BACKDROP = "radial-gradient(circle at 50% 35%, #232a33 0%, #0d1015 70%)";

const useFade = (duration: number, edge = 12) => {
  const frame = useCurrentFrame();
  return interpolate(
    frame,
    [0, edge, duration - edge, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
};

const Caption = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      position: "absolute",
      bottom: 54,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        fontFamily: SANS,
        fontSize: 40,
        fontWeight: 600,
        color: "#ffffff",
        background: "rgba(0,0,0,0.6)",
        padding: "14px 32px",
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  </div>
);

const TitleScene = () => {
  const frame = useCurrentFrame();
  const opacity = useFade(SCENES.title.duration);
  const rise = interpolate(frame, [0, 24], [30, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        background: BACKDROP,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          transform: `translateY(${rise}px)`,
          textAlign: "center",
          maxWidth: 1500,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 28,
            color: colors.keyword,
            marginBottom: 28,
            letterSpacing: 2,
          }}
        >
          playwright · testing
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 84,
            fontWeight: 700,
            color: "#ffffff",
            lineHeight: 1.12,
          }}
        >
          A Monaco editor will overwrite the code you just typed
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 36,
            color: "#9aa4b2",
            marginTop: 34,
          }}
        >
          Why a green step did not mean the code was there.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const FIXTURE = [
  "public class Solution {",
  "    static int add(int a, int b) {",
  "        return a + b;",
  "    }",
  "}",
];

const STUB = [
  "public class Solution {",
  "    // Write your code here",
  "}",
];

const BugScene = () => {
  const frame = useCurrentFrame();
  const opacity = useFade(SCENES.bug.duration);
  const WRITE_AT = 30;
  const STUB_AT = 120;

  const lines = frame < WRITE_AT ? [""] : frame < STUB_AT ? FIXTURE : STUB;
  const flash =
    frame >= STUB_AT
      ? interpolate(frame, [STUB_AT, STUB_AT + 30], [0.35, 0], {
          extrapolateRight: "clamp",
        })
      : frame >= WRITE_AT
        ? interpolate(frame, [WRITE_AT, WRITE_AT + 20], [0.25, 0], {
            extrapolateRight: "clamp",
          })
        : 0;
  const flashColor = frame >= STUB_AT ? colors.red : colors.green;

  const log: ReactNode[] = [
    <div key="lang" style={{ color: "#9aa4b2" }}>
      › test: switch language to Java
    </div>,
  ];
  if (frame >= WRITE_AT)
    log.push(
      <div key="set" style={{ color: colors.text }}>
        › test: editor.setValue(fixture)
      </div>,
    );
  if (frame >= WRITE_AT + 18)
    log.push(
      <div key="ok" style={{ color: colors.green }}>
        ✓ step passed
      </div>,
    );
  if (frame >= STUB_AT + 15)
    log.push(
      <div key="bad" style={{ color: colors.red }}>
        ✗ the editor now shows the language stub, not the fixture
      </div>,
    );

  const status =
    frame < STUB_AT ? (
      <span>
        <span style={{ color: colors.yellow }}>●</span> loading Java stub…
      </span>
    ) : (
      <span>stub loaded</span>
    );

  return (
    <AbsoluteFill
      style={{
        background: BACKDROP,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ marginTop: -70 }}>
        <EditorWindow
          filename="Solution.java"
          language="Java"
          lines={lines}
          marks={[
            {
              from: 1,
              to: lines.length,
              color: flashColor,
              opacity: flash,
            },
          ]}
          status={status}
          panel={log}
          width={1500}
          height={760}
          fontSize={30}
        />
      </div>
      <Caption>
        {frame < STUB_AT
          ? "The test writes the code. The step goes green."
          : "Then the async language stub lands on top of it."}
      </Caption>
    </AbsoluteFill>
  );
};

const OLD_HELPER = [
  "async function setCode(page, code) {",
  "  await page.evaluate((value) => {",
  "    const editors = monaco.editor.getEditors();",
  "    if (editors.length > 0) {",
  "      editors[1].setValue(value);",
  "    }",
  "  }, code);",
  "  // done. nothing checks that it stuck",
  "}",
];

const OldHelperScene = () => {
  const frame = useCurrentFrame();
  const opacity = useFade(SCENES.oldHelper.duration);
  const pulse = interpolate(frame, [20, 40, 70, 90], [0, 0.3, 0.3, 0.18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: BACKDROP,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ marginTop: -70 }}>
        <EditorWindow
          filename="editor-helper.ts  (before)"
          language="TypeScript"
          lines={OLD_HELPER}
          marks={[
            { from: 5, to: 5, color: colors.red, opacity: pulse },
            { from: 8, to: 8, color: colors.red, opacity: pulse * 0.8 },
          ]}
          width={1500}
          height={620}
          fontSize={30}
        />
      </div>
      <Caption>Write once. Never read it back.</Caption>
    </AbsoluteFill>
  );
};

const NEW_HELPER = [
  "async function setCode(page, code, index = 1) {",
  "  await page.waitForFunction(",
  "    (i) => monaco.editor.getEditors().length > i,",
  "    index, { timeout: 15_000 });",
  "  await waitUntilStable(page, index); // 3 equal reads, 200ms apart",
  "",
  "  for (let attempt = 1; attempt <= 3; attempt++) {",
  "    await setValue(page, index, code);",
  "    await page.waitForTimeout(500);",
  "    if ((await getValue(page, index)) === code) return;",
  "    console.warn(`attempt ${attempt}: value was overwritten`);",
  "  }",
  "  throw new Error(",
  "    `Failed to set code in Monaco editor at index ${index} after 3 attempts.`);",
  "}",
];

const STEPS: { label: string; detail: string; from: number; to: number }[] = [
  {
    label: "Wait for the editor",
    detail: "until index 1 exists, up to 15s",
    from: 2,
    to: 4,
  },
  {
    label: "Wait until it stops changing",
    detail: "3 equal reads, 200ms apart",
    from: 5,
    to: 5,
  },
  { label: "Write", detail: "setValue(code)", from: 8, to: 8 },
  {
    label: "Read it back",
    detail: "after 500ms, compare getValue()",
    from: 9,
    to: 10,
  },
  {
    label: "Retry, then fail loudly",
    detail: "3 attempts, then a clear error",
    from: 7,
    to: 14,
  },
];

const STEP_FRAMES = 54;
const STEP_START = 15;

const FixScene = () => {
  const frame = useCurrentFrame();
  const opacity = useFade(SCENES.fix.duration);
  const active = Math.min(
    STEPS.length - 1,
    Math.max(0, Math.floor((frame - STEP_START) / STEP_FRAMES)),
  );
  const step = STEPS[active];
  const local = (frame - STEP_START) % STEP_FRAMES;
  const markOpacity =
    frame < STEP_START
      ? 0
      : interpolate(local, [0, 10], [0.08, 0.22], {
          extrapolateRight: "clamp",
        });

  return (
    <AbsoluteFill
      style={{
        background: BACKDROP,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 36,
          alignItems: "stretch",
          marginTop: -70,
        }}
      >
        <EditorWindow
          filename="editor-helper.ts  (after)"
          language="TypeScript"
          lines={NEW_HELPER}
          marks={[
            {
              from: step.from,
              to: step.to,
              color: colors.statusBar,
              opacity: markOpacity * 2,
            },
          ]}
          width={1260}
          height={800}
          fontSize={21}
        />
        <div
          style={{
            width: 480,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 18,
          }}
        >
          {STEPS.map((s, i) => {
            const done = frame >= STEP_START && i < active;
            const current = frame >= STEP_START && i === active;
            return (
              <div
                key={s.label}
                style={{
                  background: current ? "#0b2a42" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${current ? colors.statusBar : "#2b2f36"}`,
                  borderRadius: 12,
                  padding: "16px 22px",
                  opacity: current || done ? 1 : 0.45,
                }}
              >
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 27,
                    fontWeight: 600,
                    color: "#ffffff",
                  }}
                >
                  <span
                    style={{
                      color: done ? colors.green : colors.keyword,
                      marginRight: 12,
                    }}
                  >
                    {done ? "✓" : `${i + 1}.`}
                  </span>
                  {s.label}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 19,
                    color: "#9aa4b2",
                    marginTop: 6,
                  }}
                >
                  {s.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Caption>Wait, write, then read it back.</Caption>
    </AbsoluteFill>
  );
};

const EndScene = () => {
  const opacity = useFade(SCENES.end.duration, 15);
  return (
    <AbsoluteFill
      style={{
        background: BACKDROP,
        justifyContent: "center",
        alignItems: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 92,
            fontWeight: 700,
            color: "#ffffff",
          }}
        >
          Write, then read it back.
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 34,
            color: "#9aa4b2",
            marginTop: 26,
          }}
        >
          A green step only means the call did not throw.
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 34,
            color: colors.keyword,
            marginTop: 64,
          }}
        >
          mani-krishna.vercel.app
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const MonacoOverwrite = () => (
  <AbsoluteFill style={{ background: "#0d1015" }}>
    <Sequence from={SCENES.title.from} durationInFrames={SCENES.title.duration}>
      <TitleScene />
    </Sequence>
    <Sequence from={SCENES.bug.from} durationInFrames={SCENES.bug.duration}>
      <BugScene />
    </Sequence>
    <Sequence
      from={SCENES.oldHelper.from}
      durationInFrames={SCENES.oldHelper.duration}
    >
      <OldHelperScene />
    </Sequence>
    <Sequence from={SCENES.fix.from} durationInFrames={SCENES.fix.duration}>
      <FixScene />
    </Sequence>
    <Sequence from={SCENES.end.from} durationInFrames={SCENES.end.duration}>
      <EndScene />
    </Sequence>
  </AbsoluteFill>
);
