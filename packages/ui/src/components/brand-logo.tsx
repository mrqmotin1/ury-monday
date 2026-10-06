import * as React from "react"
import { cn } from "../lib/cn"

/** Product name shown to users. Change here to rebrand every React app. */
export const BRAND_NAME = "Monday POS"

const sizes = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-3xl",
} as const

export interface BrandLogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof sizes
}

/**
 * Text wordmark ("Monday" + "POS"). To switch to an image logo later, replace
 * the body of this component only — every app header uses it.
 */
export function BrandLogo({ size = "md", className, ...props }: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label={BRAND_NAME}
      className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap leading-none tracking-tight select-none", sizes[size], className)}
      {...props}
    >
      <span className="font-extrabold text-primary">Monday</span>
      <span className="font-normal text-gray-500">POS</span>
    </span>
  )
}
