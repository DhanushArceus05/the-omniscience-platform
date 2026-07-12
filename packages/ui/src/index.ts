// Phase 0
export { StatusBadge } from "./StatusBadge";
export type { StatusBadgeTone, StatusBadgeProps } from "./StatusBadge";

// Theme system
export { ThemeProvider } from "./theme/ThemeProvider";
export type { ThemeProviderProps } from "./theme/ThemeProvider";
export { useTheme } from "./theme/useTheme";
export { themeBootstrapScript } from "./theme/themeBootstrapScript";
export { THEME_STORAGE_KEY } from "./theme/theme.types";
export type { ThemePreference, ResolvedTheme, ThemeContextValue } from "./theme/theme.types";

// Motion system
export { useReducedMotion } from "./motion/useReducedMotion";
export { Reveal, FadeIn, SlideIn, ScaleIn } from "./motion/Reveal";
export type { RevealProps, RevealVariant } from "./motion/Reveal";
export { Floating } from "./motion/Floating";
export type { FloatingProps } from "./motion/Floating";
export { Magnetic } from "./motion/Magnetic";
export type { MagneticProps } from "./motion/Magnetic";
export { RippleSurface, useRipple } from "./motion/RippleSurface";
export type { RippleSurfaceProps } from "./motion/RippleSurface";
export { RouteTransition } from "./motion/RouteTransition";
export type { RouteTransitionProps } from "./motion/RouteTransition";

// Adaptive background
export { AdaptiveBackground } from "./background/AdaptiveBackground";
export type { AdaptiveBackgroundProps } from "./background/AdaptiveBackground";

// Components
export { Button } from "./components/Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./components/Button";
export { Card } from "./components/Card";
export type { CardProps } from "./components/Card";
export { GlassCard } from "./components/GlassCard";
export type { GlassCardProps } from "./components/GlassCard";
export { Input } from "./components/Input";
export type { InputProps } from "./components/Input";
export { OtpInput } from "./components/OtpInput";
export type { OtpInputProps } from "./components/OtpInput";
export { Modal } from "./components/Modal";
export type { ModalProps } from "./components/Modal";
export { Dialog } from "./components/Dialog";
export type { DialogProps } from "./components/Dialog";
export { Drawer } from "./components/Drawer";
export type { DrawerProps } from "./components/Drawer";
export { Tooltip } from "./components/Tooltip";
export type { TooltipProps } from "./components/Tooltip";
export { Dropdown } from "./components/Dropdown";
export type { DropdownProps, DropdownItem } from "./components/Dropdown";
export { Tabs } from "./components/Tabs";
export type { TabsProps, TabItem } from "./components/Tabs";
export { Badge } from "./components/Badge";
export type { BadgeProps, BadgeTone } from "./components/Badge";
export { Avatar } from "./components/Avatar";
export type { AvatarProps, AvatarSize } from "./components/Avatar";
export { Spinner } from "./components/Spinner";
export type { SpinnerProps, SpinnerSize } from "./components/Spinner";
export { Skeleton } from "./components/Skeleton";
export type { SkeletonProps } from "./components/Skeleton";
export { Progress } from "./components/Progress";
export type { ProgressProps } from "./components/Progress";
export { ToastProvider, useToast } from "./components/Toast";
export type { ToastOptions, ToastTone } from "./components/Toast";
export { Alert } from "./components/Alert";
export type { AlertProps, AlertTone } from "./components/Alert";
export { EmptyState } from "./components/EmptyState";
export type { EmptyStateProps } from "./components/EmptyState";
export { ErrorState } from "./components/ErrorState";
export type { ErrorStateProps } from "./components/ErrorState";
