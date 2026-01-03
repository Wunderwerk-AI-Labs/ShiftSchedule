import React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & { title?: string };

export function ChevronLeftIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M12.5 4.5 7.5 10l5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M7.5 4.5 12.5 10l-5 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CogIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M11.983 2.25h.034a1 1 0 0 1 .986.854l.153 1.095a7.4 7.4 0 0 1 1.515.874l1.025-.397a1 1 0 0 1 1.258.457l.75 1.299a1 1 0 0 1-.33 1.317l-.892.67a7.3 7.3 0 0 1 0 1.751l.892.67a1 1 0 0 1 .33 1.317l-.75 1.299a1 1 0 0 1-1.258.457l-1.025-.397a7.4 7.4 0 0 1-1.515.874l-.153 1.095a1 1 0 0 1-.986.854h-.034a1 1 0 0 1-.986-.854l-.153-1.095a7.4 7.4 0 0 1-1.515-.874l-1.025.397a1 1 0 0 1-1.258-.457l-.75-1.299a1 1 0 0 1 .33-1.317l.892-.67a7.3 7.3 0 0 1 0-1.751l-.892-.67a1 1 0 0 1-.33-1.317l.75-1.299a1 1 0 0 1 1.258-.457l1.025.397a7.4 7.4 0 0 1 1.515-.874l.153-1.095a1 1 0 0 1 .986-.854Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function CalendarIcon({ title, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x="3"
        y="4"
        width="14"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3 8h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 2.5v3M13 2.5v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
