import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  PixelRatio,
  Platform,
  StatusBar as RNStatusBar,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type DrawerSnapState = "off" | "half" | "full";
export type BadgeTone =
  | "danger"
  | "warning"
  | "success"
  | "info"
  | "purple"
  | "neutral";

const TONE_COLORS: Record<
  BadgeTone,
  { bg: string; border: string; text: string }
> = {
  danger: { bg: "#FEF2F2", border: "#FECACA", text: "#DC2626" },
  warning: { bg: "#FFFBEB", border: "#FDE68A", text: "#D97706" },
  success: { bg: "#ECFDF5", border: "#A7F3D0", text: "#059669" },
  info: { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8" },
  purple: { bg: "#F3E8FF", border: "#D8B4FE", text: "#6D28D9" },
  neutral: { bg: "#F1F5F9", border: "#E2E8F0", text: "#475569" },
};

/**
 * Responsive Mobile Layout & Scaling Engine.
 * Automatically adapts typography, spacing, container widths, safe areas,
 * and drawer snap points across compact phones (320-360px), standard phones
 * (375-430px), phablets/foldables, and landscape orientations.
 */
export function useResponsiveLayout() {
  const { width: rawW, height: rawH } = useWindowDimensions();
  const width = Math.max(rawW || 390, 320);
  const height = Math.max(rawH || 780, 520);

  const isLandscape = width > height;
  const isSmallPhone = width < 365 || height < 680;
  const isLargePhone = width >= 412 && width < 720;
  const isTablet = width >= 720;

  const scale = Math.min(1.1, Math.max(0.86, width / 390));

  const fs = useCallback(
    (size: number) =>
      Math.round(PixelRatio.roundToNearestPixel(size * scale)),
    [scale]
  );

  const sp = useCallback(
    (space: number) => Math.round(space * (isSmallPhone ? 0.84 : 1)),
    [isSmallPhone]
  );

  const safeTop =
    Platform.OS === "android"
      ? (RNStatusBar.currentHeight ?? 24) + (isSmallPhone ? 4 : 6)
      : Platform.OS === "ios"
      ? 6
      : 8;

  const safeBottom = Platform.OS === "ios" ? 22 : 12;

  const horizontalMargin = isSmallPhone ? 8 : 12;
  const maxCardWidth = isTablet ? 540 : width - horizontalMargin * 2;

  const drawerCollapsedHeight = isSmallPhone
    ? 68
    : Platform.OS === "ios"
    ? 82
    : 74;
  const drawerHalfHeight = Math.round(
    height * (isLandscape ? 0.56 : isSmallPhone ? 0.48 : 0.45)
  );
  const drawerFullHeight = Math.round(
    height * (isLandscape ? 0.85 : 0.78)
  );

  return {
    width,
    height,
    isLandscape,
    isSmallPhone,
    isLargePhone,
    isTablet,
    scale,
    fs,
    sp,
    safeTop,
    safeBottom,
    horizontalMargin,
    maxCardWidth,
    drawerCollapsedHeight,
    drawerHalfHeight,
    drawerFullHeight,
  };
}

/**
 * Elevated Google-Maps-style floating surface card with responsive padding and radius.
 */
export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ children, compact = false, style }) => {
  return (
    <View
      style={[
        styles.surfaceCard,
        compact && styles.surfaceCardCompact,
        style,
      ]}
    >
      {children}
    </View>
  );
};

/**
 * Semantic status pill badge with consistent contrast.
 */
export const StatusBadge: React.FC<{
  label: string;
  tone?: BadgeTone;
  dotColor?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}> = ({ label, tone = "neutral", dotColor, icon }) => {
  const palette = TONE_COLORS[tone] || TONE_COLORS.neutral;
  return (
    <View
      style={[
        styles.statusBadge,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      {dotColor ? (
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      ) : null}
      {icon ? <Ionicons name={icon} size={11} color={palette.text} /> : null}
      <Text style={[styles.statusBadgeText, { color: palette.text }]}>
        {label}
      </Text>
    </View>
  );
};

/**
 * Touch-friendly responsive filter/destination chip with hitSlop.
 */
export const PillChip: React.FC<{
  label: string;
  active?: boolean;
  activeTone?: "blue" | "green" | "purple";
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}> = ({ label, active = false, activeTone = "blue", icon, onPress }) => {
  const activeStyle =
    activeTone === "green"
      ? styles.chipActiveGreen
      : activeTone === "purple"
      ? styles.chipActivePurple
      : styles.chipActiveBlue;
  const activeTextStyle =
    activeTone === "green"
      ? styles.chipTextActiveGreen
      : activeTone === "purple"
      ? styles.chipTextActivePurple
      : styles.chipTextActiveBlue;
  const iconColor = !active
    ? "#64748B"
    : activeTone === "green"
    ? "#15803D"
    : activeTone === "purple"
    ? "#6D28D9"
    : "#1D4ED8";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.78}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      style={[styles.chip, active && activeStyle]}
    >
      {icon ? <Ionicons name={icon} size={10.5} color={iconColor} /> : null}
      <Text style={[styles.chipText, active && activeTextStyle]}>{label}</Text>
    </TouchableOpacity>
  );
};

/**
 * Responsive Segmented Tab Control for mobile drawers and panels.
 */
export const SegmentedControl: React.FC<{
  options: Array<{ id: string; label: string }>;
  activeId: string;
  onSelect: (id: string) => void;
}> = ({ options, activeId, onSelect }) => {
  return (
    <View style={styles.segmentedWrap}>
      {options.map((opt) => {
        const active = opt.id === activeId;
        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            activeOpacity={0.85}
            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
          >
            <Text
              style={[styles.segmentText, active && styles.segmentTextActive]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

/**
 * Gesture-Driven Draggable Bottom Drawer (NO cross button — pure drag-to-open & drag-to-off).
 */
export const DraggableBottomDrawer: React.FC<{
  snap: DrawerSnapState;
  onSnapChange: (next: DrawerSnapState) => void;
  maxHeight: number;
  halfHeight: number;
  collapsedHeight: number;
  maxWidth?: number;
  title: string;
  badgeText?: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({
  snap,
  onSnapChange,
  maxHeight,
  halfHeight,
  collapsedHeight,
  maxWidth,
  title,
  badgeText,
  subtitle,
  children,
}) => {
  const offsetFull = 0;
  const offsetHalf = Math.max(70, maxHeight - halfHeight);
  const offsetOff = Math.max(160, maxHeight - collapsedHeight);

  const translateY = useRef(new Animated.Value(offsetOff)).current;
  const dragStartYRef = useRef<number>(offsetOff);
  const snapRef = useRef<DrawerSnapState>(snap);

  const animateToSnap = useCallback(
    (target: DrawerSnapState) => {
      const toVal =
        target === "full"
          ? offsetFull
          : target === "half"
          ? offsetHalf
          : offsetOff;
      snapRef.current = target;
      onSnapChange(target);
      Animated.spring(translateY, {
        toValue: toVal,
        useNativeDriver: true,
        damping: 23,
        stiffness: 220,
        mass: 0.85,
      }).start();
    },
    [offsetFull, offsetHalf, offsetOff, onSnapChange, translateY]
  );

  useEffect(() => {
    const toVal =
      snap === "full"
        ? offsetFull
        : snap === "half"
        ? offsetHalf
        : offsetOff;
    snapRef.current = snap;
    Animated.spring(translateY, {
      toValue: toVal,
      useNativeDriver: true,
      damping: 23,
      stiffness: 220,
      mass: 0.85,
    }).start();
  }, [snap, offsetFull, offsetHalf, offsetOff, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          translateY.stopAnimation((val) => {
            dragStartYRef.current = val;
          });
        },
        onPanResponderMove: (_, g) => {
          const next = Math.max(
            offsetFull,
            Math.min(offsetOff, dragStartYRef.current + g.dy)
          );
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          // Single tap on drag handle toggles between half-open and off
          if (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6) {
            animateToSnap(snapRef.current === "off" ? "half" : "off");
            return;
          }

          const endY = Math.max(
            offsetFull,
            Math.min(offsetOff, dragStartYRef.current + g.dy)
          );

          // Downward flick -> drag to off (or half if flicked gently from full)
          if (g.vy > 0.45) {
            if (snapRef.current === "full" && endY < offsetHalf && g.vy < 1.15) {
              animateToSnap("half");
            } else {
              animateToSnap("off");
            }
            return;
          }

          // Upward flick -> drag to open (half or full)
          if (g.vy < -0.45) {
            if (snapRef.current === "off" && endY > offsetHalf * 0.65) {
              animateToSnap("half");
            } else {
              animateToSnap("full");
            }
            return;
          }

          // Nearest snap point
          const dFull = Math.abs(endY - offsetFull);
          const dHalf = Math.abs(endY - offsetHalf);
          const dOff = Math.abs(endY - offsetOff);
          if (dFull <= dHalf && dFull <= dOff) {
            animateToSnap("full");
          } else if (dHalf <= dOff) {
            animateToSnap("half");
          } else {
            animateToSnap("off");
          }
        },
      }),
    [animateToSnap, offsetFull, offsetHalf, offsetOff, translateY]
  );

  return (
    <Animated.View
      style={[
        styles.drawerContainer,
        maxWidth ? { maxWidth, alignSelf: "center", width: "100%" } : null,
        {
          height: maxHeight,
          transform: [{ translateY }],
        },
      ]}
    >
      {/* Pure Gesture Drag Handle Area (No cross button) */}
      <View {...panResponder.panHandlers} style={styles.drawerHandleZone}>
        <View style={styles.handlePill} />
        <View style={styles.drawerHeaderRow}>
          <View style={styles.drawerTitleCol}>
            <View style={styles.drawerTitleRow}>
              <Text style={styles.drawerTitle}>{title}</Text>
              {badgeText ? (
                <View style={styles.drawerBadge}>
                  <Text style={styles.drawerBadgeText}>{badgeText}</Text>
                </View>
              ) : null}
            </View>
            {subtitle ? (
              <Text style={styles.drawerSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          {/* Subtle non-button drag direction hint pill */}
          <View style={styles.snapStepIndicator}>
            <Ionicons
              name={snap === "off" ? "chevron-up" : "reorder-two-outline"}
              size={14}
              color="#64748B"
            />
          </View>
        </View>
      </View>

      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  surfaceCard: {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 8,
    gap: 8,
  },
  surfaceCardCompact: {
    padding: 9,
    borderRadius: 16,
    gap: 6,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginRight: 6,
  },
  chipText: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "600",
  },
  chipActiveBlue: {
    backgroundColor: "#EFF6FF",
    borderColor: "#3B82F6",
  },
  chipTextActiveBlue: {
    color: "#1D4ED8",
    fontWeight: "800",
  },
  chipActiveGreen: {
    backgroundColor: "#DCFCE7",
    borderColor: "#22C55E",
  },
  chipTextActiveGreen: {
    color: "#15803D",
    fontWeight: "800",
  },
  chipActivePurple: {
    backgroundColor: "#F3E8FF",
    borderColor: "#A855F7",
  },
  chipTextActivePurple: {
    color: "#6D28D9",
    fontWeight: "800",
  },
  segmentedWrap: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
  },
  segmentTextActive: {
    color: "#0F172A",
    fontWeight: "800",
  },
  drawerContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 18,
    zIndex: 20,
  },
  drawerHandleZone: {
    paddingTop: 9,
    paddingBottom: 8,
  },
  handlePill: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 8,
  },
  drawerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  drawerTitleCol: {
    flex: 1,
  },
  drawerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  drawerTitle: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  drawerBadge: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
  },
  drawerBadgeText: {
    color: "#1D4ED8",
    fontSize: 10,
    fontWeight: "700",
  },
  drawerSubtitle: {
    color: "#64748B",
    fontSize: 10.5,
    fontWeight: "500",
    marginTop: 2,
  },
  snapStepIndicator: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
});
