import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The @utility text-* type scale in globals.css: sizes, not colours.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "title-page",
            "title-section",
            "title-small",
            "lead",
            "body",
            "label",
            "eyebrow",
            "caption",
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
