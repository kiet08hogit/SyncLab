"use client";

import { useId } from "react";
import styles from "./illustrated-story.module.css";

type Point = [number, number];
type Volume = {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  z?: number;
};
type Ink = {
  light: string;
  medium: string;
  dark: string;
  blue: string;
  floor: string;
};
const BLUE = "#365eff";
const project = (x: number, y: number, z = 0): Point => [
  520 + (x - y) * 0.84,
  110 + (x + y) * 0.42 - z,
];
const points = (vertices: Point[]) =>
  vertices.map((point) => point.join(",")).join(" ");
const lineProps = (start: Point, end: Point) => ({
  x1: start[0],
  y1: start[1],
  x2: end[0],
  y2: end[1],
});

function useInk(): Ink {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return {
    light: `${id}-light`,
    medium: `${id}-medium`,
    dark: `${id}-dark`,
    blue: `${id}-blue`,
    floor: `${id}-floor`,
  };
}

function InkDefinitions({ ink }: { ink: Ink }) {
  return (
    <defs>
      {(
        [
          ["light", "#fbfbf8", "#9da3ae", 0.48, 4.1],
          ["medium", "#f6f6f3", "#767d88", 0.65, 3.7],
          ["dark", "#e9eae8", "#555e6b", 0.8, 3.3],
          ["blue", "#f5f7ff", BLUE, 0.72, 3.6],
          ["floor", "#fcfcfa", "#b9bec7", 0.32, 7],
        ] as const
      ).map(([name, background, dot, radius, size]) => (
        <pattern
          key={name}
          id={ink[name]}
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <rect width={size} height={size} fill={background} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill={dot} />
        </pattern>
      ))}
    </defs>
  );
}

function Block({
  x,
  y,
  w,
  d,
  h,
  z = 0,
  ink,
  active = false,
  outline = true,
}: Volume & { ink: Ink; active?: boolean; outline?: boolean }) {
  const a = project(x, y, z + h),
    b = project(x + w, y, z + h),
    c = project(x + w, y + d, z + h),
    e = project(x, y + d, z + h);
  return (
    <g
      className={styles.stationVolume}
      stroke={outline ? (active ? BLUE : "#8f96a1") : "none"}
      strokeWidth={active ? 1.15 : 0.7}
      strokeLinejoin="round"
    >
      <polygon
        points={points([e, c, project(x + w, y + d, z), project(x, y + d, z)])}
        fill={`url(#${ink.medium})`}
      />
      <polygon
        points={points([b, c, project(x + w, y + d, z), project(x + w, y, z)])}
        fill={`url(#${ink.dark})`}
      />
      <polygon points={points([a, b, c, e])} fill={`url(#${ink.light})`} />
      <polygon
        points={points([b, c, project(x + w, y + d, z), project(x + w, y, z)])}
        fill={`url(#${ink.blue})`}
        opacity={active ? 1 : 0}
        className={styles.stationFace}
      />
      <polygon
        points={points([a, b, c, e])}
        fill={`url(#${ink.blue})`}
        opacity={active ? 1 : 0}
        className={styles.stationFace}
      />
    </g>
  );
}

function Wire({
  route,
  active = false,
  dashed = false,
}: {
  route: [number, number][];
  active?: boolean;
  dashed?: boolean;
}) {
  return (
    <polyline
      points={points(route.map(([x, y]) => project(x, y, 2)))}
      fill="none"
      stroke={active ? BLUE : "#8d96a4"}
      strokeWidth={active ? 2 : 1}
      strokeDasharray={dashed ? "3 6" : undefined}
      className={active ? styles.signalWire : undefined}
    />
  );
}

function FileStack({
  ink,
  x,
  y,
  w = 115,
  d = 85,
  active = false,
}: {
  ink: Ink;
  x: number;
  y: number;
  w?: number;
  d?: number;
  active?: boolean;
}) {
  return (
    <g>
      {[0, 1, 2, 3].map((level) => (
        <Block
          key={level}
          ink={ink}
          x={x + level * 2}
          y={y - level * 2}
          w={w}
          d={d}
          h={7}
          z={level * 11}
          active={active && level === 3}
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map((line) => (
        <line
          key={line}
          x1={project(x + 14, y + 18 + line * 8, 43)[0]}
          y1={project(x + 14, y + 18 + line * 8, 43)[1]}
          x2={project(x + 14 + (line % 2 ? 57 : 75), y + 18 + line * 8, 43)[0]}
          y2={project(x + 14 + (line % 2 ? 57 : 75), y + 18 + line * 8, 43)[1]}
          stroke={active && line === 2 ? BLUE : "#929aa6"}
          strokeWidth={line === 2 ? 3 : 1.5}
        />
      ))}
    </g>
  );
}

function Server({
  ink,
  x,
  y,
  w,
  d,
  h,
  active = false,
}: Volume & { ink: Ink; active?: boolean }) {
  return (
    <g>
      <Block x={x} y={y} w={w} d={d} h={h} ink={ink} active={active} />
      {[0, 1, 2, 3].map((row) => (
        <g key={row}>
          <line
            x1={project(x + 12, y + d + 0.1, 19 + row * 22)[0]}
            y1={project(x + 12, y + d + 0.1, 19 + row * 22)[1]}
            x2={project(x + w - 12, y + d + 0.1, 19 + row * 22)[0]}
            y2={project(x + w - 12, y + d + 0.1, 19 + row * 22)[1]}
            stroke="#747d89"
            strokeWidth={3}
          />
          <circle
            cx={project(x + w - 18, y + d + 0.2, 26 + row * 22)[0]}
            cy={project(x + w - 18, y + d + 0.2, 26 + row * 22)[1]}
            r={1.8}
            fill={active ? BLUE : "#737c89"}
          />
        </g>
      ))}
      <polygon
        points={points([
          project(x + 20, y + 20, h + 1),
          project(x + w - 20, y + 20, h + 1),
          project(x + w - 20, y + d - 20, h + 1),
          project(x + 20, y + d - 20, h + 1),
        ])}
        fill={`url(#${active ? ink.blue : ink.medium})`}
        stroke={active ? BLUE : "#9199a5"}
        strokeWidth={0.7}
      />
    </g>
  );
}

function TestBank({
  ink,
  x,
  y,
  active = false,
}: {
  ink: Ink;
  x: number;
  y: number;
  active?: boolean;
}) {
  return (
    <g>
      <Block ink={ink} x={x} y={y} w={155} d={105} h={27} active={active} />
      {Array.from({ length: 12 }, (_, index) => {
        const column = index % 4,
          row = Math.floor(index / 4);
        return (
          <Block
            key={index}
            ink={ink}
            x={x + 11 + column * 35}
            y={y + 10 + row * 29}
            w={25}
            d={20}
            h={9}
            z={28}
            active={active}
          />
        );
      })}
    </g>
  );
}

function Callout({
  x,
  y,
  number,
  label,
  active = false,
  target,
}: {
  x: number;
  y: number;
  number: string;
  label: string;
  active?: boolean;
  target?: Point;
}) {
  return (
    <g>
      {target && (
        <polyline
          points={`${x + 15},${y + 17} ${x + 15},${target[1]} ${target.join(",")}`}
          fill="none"
          stroke={active ? BLUE : "#a9b0ba"}
          strokeWidth={0.8}
        />
      )}
      <rect
        x={x}
        y={y}
        width={28}
        height={24}
        fill={active ? BLUE : "#fbfbf8"}
        stroke={active ? BLUE : "#bcc1ca"}
      />
      <text
        x={x + 14}
        y={y + 16}
        textAnchor="middle"
        fill={active ? "white" : "#606b7d"}
        fontSize={10}
        fontFamily="monospace"
      >
        {number}
      </text>
      <text
        x={x + 39}
        y={y + 16}
        fill={active ? BLUE : "#606b7d"}
        fontSize={12}
        fontFamily="monospace"
        letterSpacing={0.8}
      >
        {label}
      </text>
    </g>
  );
}

export function CodebaseArchitecture({ stage }: { stage: number }) {
  const ink = useInk();
  return (
    <svg
      viewBox="0 0 1200 660"
      className={styles.architecture}
      role="img"
      aria-label={`Illustrated codebase, with ${["provider monitoring", "affected source files", "an isolated migration sandbox", "repository verification", "a pull request for review"][stage]} highlighted in blue`}
    >
      <InkDefinitions ink={ink} />
      <g opacity={0.65} stroke="#d8dce3" strokeWidth={0.6}>
        <path d="M25 45h1150M25 615h1150M45 25v610M1155 25v610" />
        <path d="M35 45h20M45 35v20M1145 615h20M1155 605v20" stroke="#606b7d" />
      </g>
      <Block x={0} y={0} w={650} d={450} h={14} z={-14} ink={ink} />
      <polygon
        points={points([
          project(0, 0),
          project(650, 0),
          project(650, 450),
          project(0, 450),
        ])}
        fill={`url(#${ink.floor})`}
        stroke="#9aa2af"
        strokeWidth={0.8}
      />
      <Block x={0} y={0} w={650} d={7} h={55} ink={ink} />
      <Block x={0} y={0} w={7} d={450} h={55} ink={ink} />
      {Array.from({ length: 10 }, (_, i) => (
        <g key={i} stroke="#c4cad3" strokeWidth={0.5}>
          <line
            {...lineProps(
              project(40 + i * 58, 10, 1),
              project(40 + i * 58, 440, 1),
            )}
          />
          <line
            {...lineProps(
              project(10, 30 + i * 42, 1),
              project(640, 30 + i * 42, 1),
            )}
          />
        </g>
      ))}
      <Wire
        route={[
          [120, 70],
          [190, 70],
          [190, 145],
          [147, 145],
          [147, 295],
        ]}
        active={stage > 0}
      />
      <Wire
        route={[
          [147, 295],
          [270, 295],
          [270, 232],
          [377, 232],
        ]}
        active={stage > 1}
      />
      <Wire
        route={[
          [377, 232],
          [550, 232],
          [550, 65],
          [455, 65],
        ]}
        active={stage > 2}
      />
      <Wire
        route={[
          [455, 65],
          [580, 65],
          [580, 360],
          [485, 360],
        ]}
        active={stage > 3}
      />
      <g opacity={0.65}>
        <Block ink={ink} x={285} y={28} w={36} d={45} h={55} />
        <Block ink={ink} x={330} y={28} w={36} d={45} h={71} />
        <Block ink={ink} x={375} y={28} w={36} d={45} h={45} />
      </g>
      <Server
        ink={ink}
        x={70}
        y={30}
        w={100}
        d={80}
        h={110}
        active={stage === 0}
      />
      <TestBank ink={ink} x={380} y={15} active={stage === 3} />
      <Block
        ink={ink}
        x={70}
        y={220}
        w={155}
        d={150}
        h={72}
        active={stage === 1}
      />
      <g transform="translate(0 -73)">
        <FileStack
          ink={ink}
          x={80}
          y={229}
          w={130}
          d={126}
          active={stage === 1}
        />
      </g>
      <Block
        ink={ink}
        x={310}
        y={170}
        w={135}
        d={125}
        h={96}
        active={stage === 2}
      />
      <Block
        ink={ink}
        x={338}
        y={196}
        w={79}
        d={73}
        h={19}
        z={97}
        active={stage === 2}
      />
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          {...lineProps(
            project(322 + i * 15, 295, 15),
            project(322 + i * 15, 295, 78),
          )}
          stroke={stage === 2 ? "#6482ef" : "#9aa3b1"}
          strokeWidth={1}
        />
      ))}
      <FileStack ink={ink} x={43} y={390} w={70} d={40} />
      <Block
        ink={ink}
        x={430}
        y={320}
        w={110}
        d={80}
        h={109}
        active={stage === 4}
      />
      <g stroke={stage === 4 ? BLUE : "#8993a2"} strokeWidth={2} fill="none">
        <path d={`M${project(448, 400, 86).join(" ")}v43m0 -30l35 17v25`} />
        <circle
          cx={project(448, 400, 86)[0]}
          cy={project(448, 400, 86)[1]}
          r={4}
          fill="#fbfbf8"
        />
        <circle
          cx={project(448, 400, 42)[0]}
          cy={project(448, 400, 42)[1]}
          r={4}
          fill="#fbfbf8"
        />
      </g>
      <g opacity={0.8}>
        <Block ink={ink} x={584} y={288} w={26} d={28} h={40} />
        <Block ink={ink} x={584} y={325} w={26} d={28} h={55} />
        <Block ink={ink} x={584} y={362} w={26} d={28} h={32} />
      </g>
      <Callout
        x={150}
        y={67}
        number="01"
        label="PROVIDER SIGNAL"
        active={stage === 0}
        target={project(70, 70, 110)}
      />
      <Callout
        x={63}
        y={335}
        number="02"
        label="SOURCE / USAGE"
        active={stage === 1}
        target={project(70, 285, 95)}
      />
      <Callout
        x={774}
        y={143}
        number="03"
        label="ISOLATED SANDBOX"
        active={stage === 2}
        target={project(445, 170, 96)}
      />
      <Callout
        x={848}
        y={365}
        number="04"
        label="TEST SUITE"
        active={stage === 3}
        target={project(535, 65, 27)}
      />
      <Callout
        x={710}
        y={555}
        number="05"
        label="REVIEWABLE PR"
        active={stage === 4}
        target={project(540, 400, 109)}
      />
      <text x={67} y={605} className={styles.svgFine}>
        SYNCLAB / CODEBASE STUDY 001
      </text>
      <text x={1135} y={605} textAnchor="end" className={styles.svgFine}>
        ILLUSTRATIVE ARCHITECTURE
      </text>
    </svg>
  );
}


export function CapabilityDiagram({
  kind,
}: {
  kind: "signal" | "usage" | "tests" | "review";
}) {
  const ink = useInk();
  return (
    <svg
      viewBox="0 0 300 235"
      role="img"
      aria-label={
        {
          signal: "A provider release connected to a monitored change",
          usage: "A changed API call mapped to source files",
          tests: "The current and updated test suites compared",
          review: "A focused code diff connected to a pull request",
        }[kind]
      }
    >
      <InkDefinitions ink={ink} />
      {kind === "signal" && (
        <g>
          <path d="M25 182H277" stroke="#a4aab5" strokeWidth={1} />
          <path d="M25 101H277" stroke="#d7dbe3" strokeDasharray="2 5" />
          {Array.from({ length: 48 }, (_, i) => {
            const x = 28 + i * 5,
              y =
                135 -
                Math.sin(i * 0.17) * 17 -
                (i > 24 && i < 39 ? Math.sin((i - 24) * 0.21) * 52 : 0);
            return (
              <g key={i} fill={i > 25 && i < 39 ? BLUE : "#a1a7b1"}>
                <circle cx={x} cy={y + 9} r={1.4} />
                <circle cx={x + 1.5} cy={y - 6} r={1} />
              </g>
            );
          })}
          <path
            d="M28 140C62 127 82 131 106 140S150 137 166 110 191 45 210 70 232 123 268 121"
            fill="none"
            stroke={BLUE}
            strokeWidth={2}
          />
          <path d="M200 42v143" stroke={BLUE} strokeDasharray="2 4" />
          <text x={202} y={29} textAnchor="middle" className={styles.miniBlue}>
            NEW RELEASE
          </text>
          <text x={28} y={207} className={styles.miniLabel}>
            MONITOR
          </text>
          <text x={269} y={207} textAnchor="end" className={styles.miniLabel}>
            DETECT
          </text>
        </g>
      )}
      {kind === "usage" && (
        <g stroke="#a5adba" fill="#fcfcfa">
          <path
            d="M65 70L150 115 237 66M150 115v75M65 70v89M237 66v88M65 159l85 31 87-36"
            fill="none"
            strokeDasharray="3 4"
          />
          {[
            [65, 70],
            [237, 66],
            [65, 159],
            [150, 190],
            [237, 154],
          ].map(([x, y], i) => (
            <g key={i}>
              <rect
                x={x - 18}
                y={y - 17}
                width={36}
                height={36}
                fill={`url(#${ink.light})`}
              />
              <path
                d={`M${x - 10} ${y - 6}h19m-19 6h14m-14 6h17`}
                stroke="#8a94a4"
              />
            </g>
          ))}
          <rect
            x={125}
            y={89}
            width={50}
            height={50}
            stroke={BLUE}
            fill={`url(#${ink.blue})`}
          />
          <path
            d="M139 108l-6 6 6 6m22-12 6 6-6 6m-9-15-5 19"
            stroke={BLUE}
            fill="none"
            strokeWidth={1.5}
          />
          <text x={150} y={31} textAnchor="middle" className={styles.miniBlue}>
            AFFECTED USAGE
          </text>
        </g>
      )}
      {kind === "tests" && (
        <g>
          <text x={22} y={30} className={styles.miniLabel}>
            CURRENT
          </text>
          <text x={161} y={30} className={styles.miniBlue}>
            AFTER THE FIX
          </text>
          {Array.from({ length: 24 }, (_, i) => {
            const col = i % 6,
              row = Math.floor(i / 6);
            return (
              <g key={i}>
                <rect
                  x={23 + col * 18}
                  y={54 + row * 27}
                  width={12}
                  height={18}
                  fill={i > 21 ? "#f9ebe6" : `url(#${ink.light})`}
                  stroke={i > 21 ? "#ba7b65" : "#bdc3cd"}
                  strokeWidth={0.7}
                />
                <rect
                  x={163 + col * 18}
                  y={54 + row * 27}
                  width={12}
                  height={18}
                  fill={`url(#${ink.blue})`}
                  stroke={BLUE}
                  strokeWidth={0.7}
                />
              </g>
            );
          })}
          <path d="M23 181H274" stroke="#a4aab5" />
          <text x={23} y={207} className={styles.miniLabel}>
            BASELINE → CHANGE → VERIFY
          </text>
        </g>
      )}
      {kind === "review" && (
        <g>
          <rect
            x={28}
            y={48}
            width={161}
            height={135}
            fill="#fcfcfa"
            stroke="#b8bfcb"
          />
          {Array.from({ length: 6 }, (_, i) => (
            <g key={i}>
              <rect
                x={42}
                y={68 + i * 16}
                width={15}
                height={3}
                fill="#d0d5dd"
              />
              <rect
                x={69}
                y={68 + i * 16}
                width={i % 2 ? 87 : 64}
                height={3}
                fill={i === 2 || i === 3 ? BLUE : "#b2bac7"}
              />
            </g>
          ))}
          <path
            d="M189 116h39v-40"
            stroke={BLUE}
            fill="none"
            strokeDasharray="3 4"
          />
          <circle cx={228} cy={64} r={16} stroke={BLUE} fill="#fcfcfa" />
          <path
            d="m221 64 5 5 9-11"
            stroke={BLUE}
            fill="none"
            strokeWidth={1.5}
          />
          <rect
            x={206}
            y={132}
            width={59}
            height={39}
            fill={`url(#${ink.blue})`}
            stroke={BLUE}
          />
          <text
            x={235}
            y={157}
            textAnchor="middle"
            fill={BLUE}
            fontSize={12}
            fontFamily="monospace"
          >
            PR
          </text>
          <text x={28} y={207} className={styles.miniLabel}>
            A DIFF YOU CAN REVIEW
          </text>
        </g>
      )}
    </svg>
  );
}

