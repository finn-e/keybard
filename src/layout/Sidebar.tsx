import { BookOpen, HelpCircle, Keyboard, ListOrdered, LucideIcon, Mouse, Piano, Rocket, Settings } from "lucide-react";
import KeybardLogo from "@/components/icons/KeybardLogo";
import PointingDeviceBall01Icon from "@/components/icons/PointingDeviceBall01Icon";
import LayoutLayersIcon from "@/components/icons/LayoutLayersIcon";
import AltRepeatArrowsIcon from "@/components/icons/AltRepeatArrowsIcon";
import GraduationCapIcon from "@/components/icons/GraduationCapIcon";
import { useCallback, useMemo } from "react";

import ComboIcon from "@/components/ComboIcon";
import { isExcludedMenu, getIconForMenu } from "@/constants/custom-ui-exclusions";

import LayersDefaultIcon from "@/components/icons/LayersDefault";
import MacrosIcon from "@/components/icons/MacrosIcon";
import OverridesIcon from "@/components/icons/Overrides";
import TapdanceIcon from "@/components/icons/Tapdance";
import Logo from "@/components/Logo";
import {
    Sidebar,
    SidebarContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar
} from "@/components/ui/sidebar";
import { usePanels } from "@/contexts/PanelsContext";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { cn } from "@/lib/utils";
import { PARANOID } from "@/lib/paranoid";

// --- Constants ---
const MENU_ITEM_GAP_PX = 42; // Matches Gap-4 (16px) + Button Height (26px)
const DIVIDER_HEIGHT_PX = 17; // 1px + 2*8px (my-2)
const FLEX_GAP_PX = 16; // Gap-4
const DIVIDER_OFFSET = DIVIDER_HEIGHT_PX + FLEX_GAP_PX;

// Keep the icon rail fixed while the surrounding sidebar animates its width.
// Subtract the container borders so icons stay centered in the collapsed rail.
const ICON_GUTTER_CLASSES = "w-[calc(var(--sidebar-width-icon)-2px)] flex items-center justify-center shrink-0";

export type SidebarItem = {
    title: string;
    url: string;
    icon: LucideIcon | React.FC<React.SVGProps<SVGSVGElement>>;
    /** A page opened in a new tab instead of a panel. */
    href?: string;
};

// Top section items (Keyboard and Pointing Devices, before the spacer)
export const topSectionItems: SidebarItem[] = [
    { title: "Standard Keys", url: "keyboard", icon: Keyboard },
    { title: "Pointing Devices", url: "pointing", icon: PointingDeviceBall01Icon },
];

// Middle section items (after the spacer, before the divider)
export const middleSectionItems: SidebarItem[] = [
    { title: "Special Keys", url: "special", icon: Piano },
    { title: "Layer Keys", url: "layers", icon: LayersDefaultIcon },
    { title: "Mouse Keys", url: "mouse", icon: Mouse },
    { title: "Tap Dance Keys", url: "tapdances", icon: TapdanceIcon },
    { title: "Macro Keys", url: "macros", icon: MacrosIcon },
];

// For backward compatibility
export const primarySidebarItemsBeforeDynamic: SidebarItem[] = topSectionItems;
export const primarySidebarItemsAfterDynamic: SidebarItem[] = middleSectionItems;

// Combined for backward compatibility and index calculations
export const primarySidebarItems: SidebarItem[] = [
    ...topSectionItems,
    ...middleSectionItems,
];

// Alt-Repeat - enabled for testing
const SHOW_ALT_REPEAT = true;
// Leaders - enable when ready to test
const SHOW_LEADERS = true;

const featureSidebarItems: SidebarItem[] = [
    ...(SHOW_ALT_REPEAT ? [{ title: "Alt-Repeat", url: "altrepeat", icon: AltRepeatArrowsIcon }] : []),
    ...(SHOW_LEADERS ? [{ title: "Leaders", url: "leaders", icon: ListOrdered }] : []),
    { title: "Combos", url: "combos", icon: ComboIcon },
    { title: "Overrides", url: "overrides", icon: OverridesIcon },
];

const layoutSidebarItems: SidebarItem[] = [
    { title: "Layouts", url: "layouts", icon: LayoutLayersIcon },
    { title: "Overlay", url: "trainer", icon: GraduationCapIcon },
];

const footerItems: SidebarItem[] = [
    { title: "Quick Start", url: "quickstart", icon: Rocket },
    // The user manual is published beside the app (see build/manual.ts). Keybard
    // Paranoid is a single offline file, so it has no manual to link to.
    ...(PARANOID ? [] : [{ title: "Manual", url: "manual", icon: BookOpen, href: `${import.meta.env.BASE_URL}manual/` }]),
    { title: "About", url: "about", icon: HelpCircle },
    { title: "Settings", url: "settings", icon: Settings },
];

// --- Sub-components ---

const SlidingIndicator = ({ y }: { y: number }) => (
    <div
        className="absolute left-[4px] top-0 w-[3px] h-[26px] bg-kb-active z-20 transition-transform duration-300 ease-in-out pointer-events-none"
        style={{ transform: `translateY(${y}px)` }}
    />
);

interface SidebarNavItemProps {
    item: SidebarItem;
    isActive: boolean;
    isPreviousPanel?: boolean;
    alternativeHeader?: boolean;
    isCollapsed: boolean;
    onClick: (item: SidebarItem) => void;
}

const SidebarNavItem = ({
    item,
    isActive,
    isPreviousPanel,
    alternativeHeader,
    isCollapsed,
    onClick,
}: SidebarNavItemProps) => (
    <SidebarMenuItem className="cursor-pointer">
        <SidebarMenuButton
            asChild
            isActive={isActive}
            tooltip={item.title}
            sidebarName="primary-nav"
            size="nav"
            className={cn(
                "transition-colors",
                (alternativeHeader ? isPreviousPanel : isActive) ? "text-sidebar-foreground" : "text-gray-400 dark:text-neutral-400"
            )}
        >
            {item.href ? (
                <a href={item.href} target="_blank" rel="noopener" aria-label={item.title} className="flex w-full items-center justify-start">
                    <div className={cn(ICON_GUTTER_CLASSES, "h-full")}>
                        <item.icon className="h-5 w-5 shrink-0" />
                    </div>
                    <span className={cn("truncate", isCollapsed && "hidden")}>
                        {item.title}
                    </span>
                </a>
            ) : (
                <button type="button" aria-label={item.title} aria-pressed={isActive} onClick={() => onClick(item)} className="flex w-full items-center justify-start">
                    <div className={cn(ICON_GUTTER_CLASSES, "h-full")}>
                        <item.icon className="h-5 w-5 shrink-0" />
                    </div>
                    <span className={cn("truncate", isCollapsed && "hidden")}>
                        {item.title}
                    </span>
                </button>
            )}
        </SidebarMenuButton>
    </SidebarMenuItem>
);

// --- Main Component ---

const AppSidebar = () => {
    const { state, toggleSidebar, setOpen: setNavigationOpen } = useSidebar("primary-nav", { defaultOpen: false });
    const isCollapsed = state === "collapsed";
    const {
        setItemToEdit,
        setActivePanel,
        openDetails,
        activePanel,
        panelToGoBack,
        alternativeHeader,
        setPanelToGoBack,
        setAlternativeHeader,
        open,
        handleCloseDetails,
        setOpen,
    } = usePanels();

    const { keyboard } = useKeyboard();



    const handleItemSelect = useCallback(
        (item: SidebarItem) => {
            // Labels can be expanded to choose a destination; return the narrow
            // viewport to its icon rail so the chosen panel remains usable.
            if (window.innerWidth < 900) setNavigationOpen(false);
            if (item.url === "matrixtester" || item.url === "trainer") {
                if (activePanel === item.url) {
                    setActivePanel(null);
                    return;
                }
                setOpen(false);
                setActivePanel(item.url);
                setPanelToGoBack(null);
                setItemToEdit(null);
                return;
            }

            if (activePanel === item.url && open) {
                handleCloseDetails();
            } else {
                setActivePanel(item.url);
                openDetails();
                setPanelToGoBack(null);
                setAlternativeHeader(false);
                setItemToEdit(null);
            }
        },
        [setNavigationOpen, activePanel, open, handleCloseDetails, setActivePanel, openDetails, setPanelToGoBack, setAlternativeHeader, setItemToEdit, setOpen]
    );



    // Build dynamic menu items from keyboard definition
    const dynamicMenuItems: SidebarItem[] = useMemo(() => {
        if (!keyboard?.menus) return [];

        return keyboard.menus
            .map((menu, originalIndex) => ({ menu, originalIndex }))
            .filter(({ menu }) => !isExcludedMenu(menu.label))
            .map(({ menu, originalIndex }) => {
                const iconName = getIconForMenu(menu.label);
                // Map icon name to component
                const IconComponent = iconName === 'target' ? PointingDeviceBall01Icon : iconName === 'mouse' ? Mouse : Settings;

                return {
                    title: menu.label || `Menu ${originalIndex}`,
                    url: `dynamic-menu-${originalIndex}`,
                    icon: IconComponent,
                };
            });
    }, [keyboard?.menus]);

    const activeTopIndex = topSectionItems.findIndex((item) => item.url === activePanel);
    const activeMiddleIndex = middleSectionItems.findIndex((item) => item.url === activePanel);
    const activeFeatureIndex = featureSidebarItems.findIndex((item) => item.url === activePanel);
    const activeLayoutIndex = layoutSidebarItems.findIndex((item) => item.url === activePanel);
    const activeDynamicIndex = dynamicMenuItems.findIndex((item) => item.url === activePanel);
    const activeFooterIndex = footerItems.findIndex((item) => item.url === activePanel);

    let indicatorY = -1;
    if (activeTopIndex !== -1) {
        // Top section items (Keyboard, Pointing Devices)
        indicatorY = activeTopIndex * MENU_ITEM_GAP_PX;
    } else if (activeDynamicIndex !== -1 && dynamicMenuItems.length > 0) {
        // Dynamic menu items - right after Pointing Devices
        indicatorY = (topSectionItems.length * MENU_ITEM_GAP_PX) + (activeDynamicIndex * MENU_ITEM_GAP_PX);
    } else if (activeMiddleIndex !== -1) {
        // Middle section items - after first divider
        indicatorY = (topSectionItems.length * MENU_ITEM_GAP_PX)
            + (dynamicMenuItems.length * MENU_ITEM_GAP_PX)
            + DIVIDER_OFFSET
            + (activeMiddleIndex * MENU_ITEM_GAP_PX);
    } else if (activeFeatureIndex !== -1) {
        // Feature items - after two dividers
        indicatorY = (topSectionItems.length * MENU_ITEM_GAP_PX)
            + (dynamicMenuItems.length * MENU_ITEM_GAP_PX)
            + DIVIDER_OFFSET
            + (middleSectionItems.length * MENU_ITEM_GAP_PX)
            + DIVIDER_OFFSET
            + (activeFeatureIndex * MENU_ITEM_GAP_PX);
    } else if (activeLayoutIndex !== -1) {
        // Layout items - after three dividers
        indicatorY = (topSectionItems.length * MENU_ITEM_GAP_PX)
            + (dynamicMenuItems.length * MENU_ITEM_GAP_PX)
            + DIVIDER_OFFSET
            + (middleSectionItems.length * MENU_ITEM_GAP_PX)
            + DIVIDER_OFFSET
            + (featureSidebarItems.length * MENU_ITEM_GAP_PX)
            + DIVIDER_OFFSET
            + (activeLayoutIndex * MENU_ITEM_GAP_PX);
    }

    const sidebarClasses = cn(
        "z-11 fixed transition-[box-shadow,border-color] duration-300 ease-out border border-sidebar-border shadow-lg ml-2 h-[98vh] mt-[1vh] transition-all",
        "rounded-3xl select-none"
    );

    return (
        <>
            {/* Hidden file input for import */}



            <Sidebar rounded name="primary-nav" defaultOpen={false} collapsible="icon" hideGap className={sidebarClasses}>
                <SidebarContent className={cn("py-4 overflow-y-auto overflow-x-hidden flex flex-col", isCollapsed && "scrollbar-none")}>
                    {/* Header section - Logo, Connect, Import/Export */}
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                asChild
                                size="nav"
                                sidebarName="primary-nav"
                                className="transition-colors !overflow-visible !h-auto"
                            >
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-start"
                                    aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
                                    aria-expanded={!isCollapsed}
                                    onClick={() => toggleSidebar()}
                                >
                                    <div className={cn(ICON_GUTTER_CLASSES, "h-8")}>
                                        <Logo className="!w-6 !h-6 !min-w-6 !min-h-6" />
                                    </div>
                                    <KeybardLogo className={cn("shrink-0 !h-[32px] !w-auto", isCollapsed && "hidden")} />
                                </button>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>

                    {/* Main navigation - vertically centered in available space */}
                    <div className="flex-1 flex flex-col justify-center py-2">
                        <SidebarMenu className="relative">
                            {indicatorY !== -1 && <SlidingIndicator y={indicatorY} />}

                            {/* Top section items (Keyboard, Pointing Devices) */}
                            {topSectionItems.map((item) => (
                                <SidebarNavItem
                                    key={item.url}
                                    item={item}
                                    isActive={activePanel === item.url}
                                    isPreviousPanel={panelToGoBack === item.url}
                                    alternativeHeader={alternativeHeader}
                                    isCollapsed={isCollapsed}
                                    onClick={handleItemSelect}
                                />
                            ))}

                            {/* Dynamic menu items from keyboard definition - right after Pointing Devices */}
                            {dynamicMenuItems.map((item) => (
                                <SidebarNavItem
                                    key={item.url}
                                    item={item}
                                    isActive={activePanel === item.url}
                                    isPreviousPanel={panelToGoBack === item.url}
                                    alternativeHeader={alternativeHeader}
                                    isCollapsed={isCollapsed}
                                    onClick={handleItemSelect}
                                />
                            ))}

                            {/* Divider between top section and middle section */}
                            <div className="mx-4 my-2 h-[1px] bg-slate-400 dark:bg-neutral-600" />

                            {/* Middle section items (Special, Layer Keys, Mouse Keys, Tap Dances, Macros) */}
                            {middleSectionItems.map((item) => (
                                <SidebarNavItem
                                    key={item.url}
                                    item={item}
                                    isActive={activePanel === item.url}
                                    isPreviousPanel={panelToGoBack === item.url}
                                    alternativeHeader={alternativeHeader}
                                    isCollapsed={isCollapsed}
                                    onClick={handleItemSelect}
                                />
                            ))}

                            <div className="mx-4 my-2 h-[1px] bg-slate-400 dark:bg-neutral-600" />

                            {featureSidebarItems.map((item) => (
                                <SidebarNavItem
                                    key={item.url}
                                    item={item}
                                    isActive={activePanel === item.url}
                                    isPreviousPanel={panelToGoBack === item.url}
                                    alternativeHeader={alternativeHeader}
                                    isCollapsed={isCollapsed}
                                    onClick={handleItemSelect}
                                />
                            ))}

                            <div className="mx-4 my-2 h-[1px] bg-slate-400 dark:bg-neutral-600" />

                            {layoutSidebarItems.map((item) => (
                                <SidebarNavItem
                                    key={item.url}
                                    item={item}
                                    isActive={activePanel === item.url}
                                    isPreviousPanel={panelToGoBack === item.url}
                                    alternativeHeader={alternativeHeader}
                                    isCollapsed={isCollapsed}
                                    onClick={handleItemSelect}
                                />
                            ))}
                        </SidebarMenu>
                    </div>

                    {/* Footer section - Quick Start, Manual, About, Settings */}
                    <div className="py-2 mb-3">
                        <SidebarMenu className="relative">
                            {activeFooterIndex !== -1 && <SlidingIndicator y={activeFooterIndex * MENU_ITEM_GAP_PX} />}
                            {footerItems.map((item) => (
                                <SidebarNavItem
                                    key={item.url}
                                    item={item}
                                    isActive={activePanel === item.url}
                                    isCollapsed={isCollapsed}
                                    onClick={handleItemSelect}
                                />
                            ))}
                        </SidebarMenu>

                    </div>
                </SidebarContent>
            </Sidebar>
        </>
    );
};

export default AppSidebar;
