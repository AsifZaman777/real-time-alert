import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface VeracityMeterProps {
  veracityPercent: number;
  credibilityScore: number;
  veracityStatus: string;
  veracitySummary: string;
  sources: string[];
  compact?: boolean;
}

export const VeracityMeter: React.FC<VeracityMeterProps> = ({
  veracityPercent,
  credibilityScore,
  veracityStatus,
  veracitySummary,
  sources,
  compact = false,
}) => {
  const barColor =
    veracityPercent >= 80
      ? "#10B981"
      : veracityPercent >= 60
      ? "#F59E0B"
      : "#F43F5E";

  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <View style={styles.headerRow}>
        <View style={styles.labelRow}>
          <Ionicons
            name={veracityPercent >= 60 ? "shield-checkmark" : "alert-circle"}
            size={13}
            color={barColor}
          />
          <Text style={styles.label}>VERACITY METER</Text>
        </View>
        <View style={[styles.badge, { borderColor: barColor }]}>
          <Text style={[styles.badgeText, { color: barColor }]}>
            {veracityStatus}
          </Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.percentText, { color: barColor }]}>
          {veracityPercent}%
        </Text>
        <Text style={styles.summaryText}>{veracitySummary}</Text>
        <Text style={styles.rawScore}>({credibilityScore.toFixed(2)})</Text>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.min(100, Math.max(8, veracityPercent))}%`,
              backgroundColor: barColor,
            },
          ]}
        />
      </View>

      {!compact && sources.length > 0 && (
        <View style={styles.sourcesWrap}>
          {sources.map((src) => (
            <View key={src} style={styles.sourceChip}>
              <Text style={styles.sourceChipText}>{src}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginTop: 8,
  },
  compactContainer: {
    padding: 8,
    marginTop: 6,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  label: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#FFFFFF",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 6,
  },
  percentText: {
    fontSize: 17,
    fontWeight: "800",
  },
  summaryText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  rawScore: {
    color: "#64748B",
    fontSize: 11,
  },
  track: {
    height: 6,
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  sourcesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  sourceChip: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sourceChipText: {
    color: "#1D4ED8",
    fontSize: 11,
    fontWeight: "600",
  },
});
