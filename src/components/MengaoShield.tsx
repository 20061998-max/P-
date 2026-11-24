interface MengaoShieldProps {
  className?: string;
}

export function MengaoShield({ className = 'h-8 w-8' }: MengaoShieldProps) {
  return (
    <svg
      viewBox="0 0 120 132"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="mengaoShieldClip">
          <path d="M12 10H108V68C108 98 83 116 60 124C37 116 12 98 12 68V10Z" />
        </clipPath>
      </defs>
      <path
        d="M10 8H110V68C110 100 84 118 60 126C36 118 10 100 10 68V8Z"
        fill="#09090B"
        stroke="#F4F4F5"
        strokeWidth="3.5"
      />
      <g clipPath="url(#mengaoShieldClip)">
        <rect x="12" y="10" width="96" height="19" fill="#C8102E" />
        <rect x="12" y="29" width="96" height="19" fill="#09090B" />
        <rect x="12" y="48" width="96" height="19" fill="#C8102E" />
        <rect x="12" y="67" width="96" height="19" fill="#09090B" />
        <rect x="12" y="86" width="96" height="19" fill="#C8102E" />
        <rect x="12" y="105" width="96" height="22" fill="#09090B" />
      </g>
      <rect x="12" y="10" width="44" height="44" fill="#C8102E" stroke="#F4F4F5" strokeWidth="2.5" />
      <text
        x="34"
        y="39"
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="21"
        letterSpacing="-1"
      >
        CRF
      </text>
    </svg>
  );
}
