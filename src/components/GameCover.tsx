import { GameSlug } from "@/lib/games";

export default function GameCover({ slug }: { slug: GameSlug }) {
  return (
    <div className="relative h-40 w-full overflow-hidden">
      {slug === "spiderman" && (
        <div className="absolute inset-0 bg-gradient-to-br from-[#8b1a1a] via-[#3b0f4f] to-[#0d1b5e]">
          <svg
            className="absolute inset-0 h-full w-full opacity-50"
            viewBox="0 0 400 160"
            preserveAspectRatio="none"
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <line
                key={i}
                x1={200}
                y1={0}
                x2={i * 50}
                y2={160}
                stroke="white"
                strokeWidth="0.6"
              />
            ))}
            {[30, 60, 90, 120].map((r) => (
              <path
                key={r}
                d={`M ${200 - r * 2} 160 A ${r * 2} ${r * 1.3} 0 0 1 ${200 + r * 2} 160`}
                fill="none"
                stroke="white"
                strokeWidth="0.6"
              />
            ))}
          </svg>
          <div className="absolute bottom-0 inset-x-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <svg
            className="absolute bottom-0 inset-x-0 h-1/2 w-full opacity-70"
            viewBox="0 0 400 80"
            preserveAspectRatio="none"
          >
            {Array.from({ length: 14 }).map((_, i) => (
              <rect
                key={i}
                x={i * 30 + 4}
                y={80 - ((i * 37) % 55) - 18}
                width={20}
                height={80}
                fill="#0a0a18"
                stroke="#223"
                strokeWidth="0.5"
              />
            ))}
          </svg>
        </div>
      )}

      {slug === "drift" && (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a0533] via-[#3b0764] to-[#7c2d12]">
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 400 160"
            preserveAspectRatio="none"
          >
            {[0, 1, 2, 3].map((i) => (
              <path
                key={i}
                d={`M ${40 + i * 20} 150 Q ${150 + i * 15} ${90 - i * 12} ${330 + i * 10} ${60 + i * 18}`}
                fill="none"
                stroke={i % 2 ? "#fb923c" : "#c084fc"}
                strokeWidth={2.5 - i * 0.4}
                strokeLinecap="round"
                opacity={0.9 - i * 0.18}
                strokeDasharray={i === 3 ? "6 8" : undefined}
              />
            ))}
          </svg>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(251,146,60,0.25),transparent_55%)]" />
        </div>
      )}

      {slug === "f16" && (
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c1e3e] via-[#16406e] to-[#0a0f1e]">
          <div className="absolute top-4 right-6 h-10 w-10 rounded-full bg-sky-200/80 blur-[6px]" />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 400 160"
            preserveAspectRatio="none"
          >
            <path
              d="M200 30 L214 95 L260 110 L214 118 L208 140 L200 132 L192 140 L186 118 L140 110 L186 95 Z"
              fill="#9fb8cc"
              opacity="0.9"
            />
            {[80, 120].map((y, i) => (
              <line
                key={i}
                x1={40}
                y1={y}
                x2={170 - i * 30}
                y2={y - 6}
                stroke="#7dd3fc"
                strokeWidth="1"
                opacity={0.5 - i * 0.2}
              />
            ))}
          </svg>
          <svg
            className="absolute bottom-0 inset-x-0 h-1/3 w-full"
            viewBox="0 0 400 55"
            preserveAspectRatio="none"
          >
            {Array.from({ length: 16 }).map((_, i) => (
              <rect
                key={i}
                x={i * 26 + 3}
                y={55 - ((i * 29) % 40) - 12}
                width={16}
                height={55}
                fill="#060a16"
              />
            ))}
          </svg>
        </div>
      )}

      {slug === "traffic" && (
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a14] via-[#10101f] to-[#05050c]">
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 400 160"
            preserveAspectRatio="none"
          >
            {[1, 2, 3].map((i) => (
              <line
                key={i}
                x1={200 + i * 26 - 52}
                y1={0}
                x2={200 + i * 90 - 135}
                y2={160}
                stroke="#fbbf24"
                strokeWidth="2"
                strokeDasharray="14 18"
                opacity="0.7"
              />
            ))}
            {[
              { x: 130, y: 40 },
              { x: 250, y: 70 },
              { x: 185, y: 110 },
            ].map((p, i) => (
              <g key={i}>
                <ellipse cx={p.x - 9} cy={p.y} rx={4} ry={2.5} fill="#fef08a" />
                <ellipse cx={p.x + 9} cy={p.y} rx={4} ry={2.5} fill="#fef08a" />
                <ellipse
                  cx={p.x}
                  cy={p.y}
                  rx={26}
                  ry={9}
                  fill="#fef08a"
                  opacity="0.12"
                />
              </g>
            ))}
            {[
              { x: 160, y: 60 },
              { x: 290, y: 100 },
            ].map((p, i) => (
              <g key={i}>
                <ellipse cx={p.x - 8} cy={p.y} rx={3.5} ry={2} fill="#f87171" />
                <ellipse cx={p.x + 8} cy={p.y} rx={3.5} ry={2} fill="#f87171" />
              </g>
            ))}
          </svg>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_110%,rgba(245,158,11,0.18),transparent_60%)]" />
        </div>
      )}
    </div>
  );
}
