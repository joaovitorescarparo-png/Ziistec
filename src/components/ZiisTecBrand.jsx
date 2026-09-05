import React from "react";

export const ZIISTEC_BRAND_ASSETS = Object.freeze({
  horizontalLight: "/brand/ziistec-horizontal-light.png",
  horizontalDark: "/brand/ziistec-horizontal-dark.png",
  icon: "/brand/ziistec-icon.png",
  favicon: "/brand/ziistec-favicon.png",
});

export function ZiisTecLogo({ dark = false, className = "h-12 w-auto", alt = "ZiisTec" }) {
  return (
    <img
      src={dark ? ZIISTEC_BRAND_ASSETS.horizontalDark : ZIISTEC_BRAND_ASSETS.horizontalLight}
      alt={alt}
      className={`object-contain ${className}`}
      draggable="false"
    />
  );
}

export function ZiisTecIcon({ className = "h-9 w-9", alt = "" }) {
  return (
    <img
      src={ZIISTEC_BRAND_ASSETS.icon}
      alt={alt}
      className={`object-contain ${className}`}
      draggable="false"
      aria-hidden={alt ? undefined : true}
    />
  );
}
