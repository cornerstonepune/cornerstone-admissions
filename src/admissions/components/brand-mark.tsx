// The Cornerstone logo, one of the four official files drawn exactly as given (ported from design/platform/components/brand-mark.tsx;
// files copied byte for byte to public/brand). Never recoloured, stretched or shadowed. The bar is dark: the lockup for dark
// backgrounds, and on a phone (700 px or less) the mark on its white tile.
const F = (name: string) => `/brand/Cornerstone-logo-${name}.svg`;

export const BRAND_NAME = "Cornerstone Admissions";

export function BrandMark() {
  return (
    <picture data-brand-mark className="block leading-none">
      <source media="(max-width: 700px)" srcSet={F("mark-on-white-tile")} />
      {/* a vector, drawn as it is: never resized by the server */}
      <img src={F("lockup-for-dark-backgrounds")} alt={BRAND_NAME} className="h-[var(--space-4)] w-auto" />
    </picture>
  );
}
