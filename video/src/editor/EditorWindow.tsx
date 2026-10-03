import type { CSSProperties, ReactNode } from "react";
import { colors, highlightLine } from "./highlight";

export const MONO = 'Menlo, "SF Mono", Consolas, monospace';
export const SANS =
  '-apple-system, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif';

export type LineMark = {
  from: number;
  to: number;
  color: string;
  opacity?: number;
};

type Props = {
  filename: string;
  language: string;
  lines: string[];
  marks?: LineMark[];
  visibleLines?: number;
  status?: ReactNode;
  panel?: ReactNode;
  width: number;
  height: number;
  fontSize?: number;
  style?: CSSProperties;
};

const Dot = ({ color }: { color: string }) => (
  <div
    style={{ width: 14, height: 14, borderRadius: 7, background: color }}
  />
);

export const EditorWindow = ({
  filename,
  language,
  lines,
  marks = [],
  visibleLines = lines.length,
  status,
  panel,
  width,
  height,
  fontSize = 26,
  style,
}: Props) => {
  const lineHeight = Math.round(fontSize * 1.65);
  return (
    <div
      style={{
        width,
        height,
        background: colors.bg,
        borderRadius: 14,
        border: `1px solid ${colors.border}`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: SANS,
        ...style,
      }}
    >
      <div
        style={{
          height: 48,
          background: colors.tabBar,
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingLeft: 20,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Dot color="#ff5f57" />
        <Dot color="#febc2e" />
        <Dot color="#28c840" />
        <div
          style={{
            marginLeft: 28,
            height: 48,
            display: "flex",
            alignItems: "center",
            padding: "0 22px",
            background: colors.activeTab,
            borderTop: `2px solid ${colors.statusBar}`,
            color: "#ffffff",
            fontSize: 20,
          }}
        >
          {filename}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          position: "relative",
          paddingTop: 18,
          fontFamily: MONO,
          fontSize,
          lineHeight: `${lineHeight}px`,
        }}
      >
        {marks.map((m, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 18 + (m.from - 1) * lineHeight,
              height: (m.to - m.from + 1) * lineHeight,
              background: m.color,
              opacity: m.opacity ?? 1,
            }}
          />
        ))}
        {lines.slice(0, visibleLines).map((line, i) => (
          <div key={i} style={{ display: "flex", position: "relative" }}>
            <div
              style={{
                width: 76,
                textAlign: "right",
                paddingRight: 26,
                color: colors.lineNumber,
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <div style={{ whiteSpace: "pre" }}>{highlightLine(line)}</div>
          </div>
        ))}
      </div>

      {panel ? (
        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            background: colors.sidebar,
            padding: "14px 28px",
            fontFamily: MONO,
            fontSize: 22,
            lineHeight: "36px",
            minHeight: 150,
          }}
        >
          {panel}
        </div>
      ) : null}

      <div
        style={{
          height: 36,
          background: colors.statusBar,
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          fontSize: 18,
        }}
      >
        <div>{status}</div>
        <div>{language}</div>
      </div>
    </div>
  );
};
