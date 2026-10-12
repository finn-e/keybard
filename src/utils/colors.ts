export const layerColors = [
    { name: "green", hex: "#099e7c", led: { hue: 90, sat: 255, val: 255 } },
    { name: "blue", hex: "#379cd7", led: { hue: 149, sat: 255, val: 255 } },
    { name: "purple", hex: "#8672b5", led: { hue: 188, sat: 255, val: 255 } },
    { name: "orange", hex: "#f89804", led: { hue: 27, sat: 255, val: 255 } },
    { name: "brown", hex: "#b39369", led: { hue: 28, sat: 255, val: 255 } },
    { name: "magenta", hex: "#b5508a", led: { hue: 224, sat: 255, val: 255 } },
    { name: "yellow", hex: "#ffc222", led: { hue: 40, sat: 255, val: 255 } },
    { name: "red", hex: "#d8304a", led: { hue: 244, sat: 255, val: 255 } },
    { name: "grey", hex: "#85929b", led: { hue: 0, sat: 0, val: 150 } },
    { name: "light-grey", hex: "#D8D8D8", led: { hue: 0, sat: 0, val: 200 } },
    { name: "white", hex: "#ffffff", led: { hue: 0, sat: 0, val: 255 } },
];

// function to get color by name
/** A custom layer color: a "#rrggbb" hex code instead of a preset name. */
export function isHexColor(color: string | undefined): color is string {
    return !!color && /^#[0-9a-f]{6}$/i.test(color);
}

/** The text class (white or black) that reads best on a custom hex background. */
export function textClassForHex(hex: string): "text-white" | "text-black" {
    const channel = (i: number) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    // Contrast with white is 1.05 / (L + 0.05), with black (L + 0.05) / 0.05; they meet at L ~ 0.18.
    return luminance > 0.179 ? "text-black" : "text-white";
}

/** A preset layer color by name, or a custom hex color as { name, hex }. */
export function getColorByName(name: string): { name: string; hex: string } | undefined {
    if (isHexColor(name)) return { name, hex: name };
    return layerColors.find((color) => color.name === name);
}

export function getClassNameByColor(name: string) {
    return `bg-kb-${name}`;
}

export const colorClasses: { [key: string]: string } = {
    primary: "bg-kb-primary text-white",
    black: "bg-black text-white",
    sidebar: "bg-kb-sidebar-base text-white",
    red: "bg-kb-red text-white",
    green: "bg-kb-green text-white",
    blue: "bg-kb-blue text-white",
    yellow: "bg-kb-yellow text-orange-800",
    orange: "bg-kb-orange text-white",
    purple: "bg-kb-purple text-white",
    grey: "bg-kb-grey text-gray-200",
    "light-grey": "bg-kb-light-grey text-black",
    brown: "bg-kb-brown text-white",
    magenta: "bg-kb-magenta text-white",
    white: "bg-white text-black",
};

export const hoverBorderClasses: { [key: string]: string } = {
    primary: "hover:border-kb-primary",
    black: "hover:border-black",
    sidebar: "hover:border-kb-sidebar-base",
    red: "hover:border-kb-red",
    green: "hover:border-kb-green",
    blue: "hover:border-kb-blue",
    yellow: "hover:border-kb-yellow",
    orange: "hover:border-kb-orange",
    purple: "hover:border-kb-purple",
    grey: "hover:border-kb-grey",
    "light-grey": "hover:border-kb-light-grey",
    brown: "hover:border-kb-brown",
    magenta: "hover:border-kb-magenta",
    white: "hover:border-gray-300",
};

export const hoverBackgroundClasses: { [key: string]: string } = {
    primary: "hover:bg-kb-primary",
    black: "hover:bg-black",
    sidebar: "hover:bg-kb-sidebar-base",
    red: "hover:bg-kb-red",
    green: "hover:bg-kb-green",
    blue: "hover:bg-kb-blue",
    yellow: "hover:bg-kb-yellow",
    orange: "hover:bg-kb-orange",
    purple: "hover:bg-kb-purple",
    grey: "hover:bg-kb-grey",
    "light-grey": "hover:bg-kb-light-grey",
    brown: "hover:bg-kb-brown",
    magenta: "hover:bg-kb-magenta",
    white: "hover:bg-white",
};

/**
 * Darker header/footer classes for each color (used in key headers)
 * These match the bg-black/30 overlay effect on the base colors
 */
export const headerClasses: { [key: string]: string } = {
    primary: "bg-black/30",
    black: "bg-black/50",
    sidebar: "bg-kb-sidebar-dark",
    red: "bg-black/30",
    green: "bg-black/30",
    blue: "bg-black/30",
    yellow: "bg-black/30",
    orange: "bg-black/30",
    purple: "bg-black/30",
    grey: "bg-black/30",
    "light-grey": "bg-black/30",
    brown: "bg-black/30",
    magenta: "bg-black/30",
    white: "bg-black",
};

/**
 * Hover header/footer classes for each color
 */
export const hoverHeaderClasses: { [key: string]: string } = {
    primary: "group-hover:bg-black/30",
    black: "group-hover:bg-black/50",
    sidebar: "group-hover:bg-kb-sidebar-dark",
    red: "group-hover:bg-black/30",
    green: "group-hover:bg-black/30",
    blue: "group-hover:bg-black/30",
    yellow: "group-hover:bg-black/30",
    orange: "group-hover:bg-black/30",
    purple: "group-hover:bg-black/30",
    grey: "group-hover:bg-black/30",
    "light-grey": "group-hover:bg-black/30",
    brown: "group-hover:bg-black/30",
    magenta: "group-hover:bg-black/30",
    white: "group-hover:bg-black",
};

/**
 * Hover text color classes for each color
 * These are used to ensure text color matches the layer color on hover
 */
export const hoverTextClasses: { [key: string]: string } = {
    primary: "group-hover:text-white",
    black: "group-hover:text-white",
    sidebar: "group-hover:text-white",
    red: "group-hover:text-white",
    green: "group-hover:text-white",
    blue: "group-hover:text-white",
    yellow: "group-hover:text-orange-800",
    orange: "group-hover:text-white",
    purple: "group-hover:text-white",
    grey: "group-hover:text-gray-200",
    "light-grey": "group-hover:text-black",
    brown: "group-hover:text-white",
    magenta: "group-hover:text-white",
    white: "group-hover:text-black",
};

/**
 * Container Hover text color classes for each color
 * These use hover: instead of group-hover: to target the element itself rather than a parent group
 */
export const hoverContainerTextClasses: { [key: string]: string } = {
    primary: "hover:text-white",
    black: "hover:text-white",
    sidebar: "hover:text-white",
    red: "hover:text-white",
    green: "hover:text-white",
    blue: "hover:text-white",
    yellow: "hover:text-orange-800",
    orange: "hover:text-white",
    purple: "hover:text-white",
    grey: "hover:text-gray-200",
    "light-grey": "hover:text-black",
    brown: "hover:text-white",
    magenta: "hover:text-white",
    white: "hover:text-black",
};

/**
 * Active background classes for each color
 * Used for click/active states
 */


/**
 * Active text color classes for each color
 * Used for click/active states to ensure contrast
 */

