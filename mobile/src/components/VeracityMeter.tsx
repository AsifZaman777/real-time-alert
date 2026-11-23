import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CrowdMetrics } from "../types/alert";

interface VeracityMeterProps {
  veracityPercent: number;
  credibilityScore: number;
  veracityStatus: string;
  veracitySummary: string;
  sources: string[];
  crowdMetrics?: CrowdMetrics;
  isPreNewsCrowd?: boolean;
  onCrowdVote?: (vote: "confirm" | "clear") => void;
  compact?: boolean;
}

export const VeracityMeter: React.FC<VeracityMeterProps> = ({
  veracityPercent,
  credibilityScore,
  veracityStatus,
  veracitySummary,
  sources,
  crowdMetrics,
  isPreNewsCrowd = false,
  onCrowdVote,
  compact = false,
}) => {
  const barColor =
    veracityPercent >= 80
      ? "#10B981"
      : veracityPercent >= 60
      ? "#F59E0B"
      : "#F43F5E";

  const cwPct = crowdMetrics?.crowd_weight_percent ?? 0;
  const cwSign = cwPct >= 0 ? `+${cwPct}%` : `${cwPct}%`;
  const h3Index = (crowdMetrics?.h3_index || "893c06a4c27ffff").slice(0, 10);
  const onlineDevices =
    crowdMetrics?.online_devices ?? crowdMetrics?.gathering_size ?? 420;
  const baselineSize = crowdMetrics?.baseline_size ?? 520;
  const dbscanCore =
    crowdMetrics?.dbscan_core_devices ?? Math.round(onlineDevices * 0.72);
  const zScore = crowdMetrics?.z_score_sigma ?? 1.8;
  const zSign = zScore >= 0 ? `+${zScore.toFixed(1)}σ` : `${zScore.toFixed(1)}σ`;
  const isNormalHub = crowdMetrics?.is_normal_hub_crowd ?? zScore < 1.3;
  const stuckPct = crowdMetrics?.stuck_percent ?? 84;
  const movingPct = crowdMetrics?.moving_percent ?? 100 - stuckPct;
  const avgSpeedKmh = crowdMetrics?.avg_speed_kmh ?? 1.2;
  const dwellMin = crowdMetrics?.dwell_minutes ?? 16;
  const isStuckAnomaly = !isNormalHub && stuckPct >= 65;

  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <View style={styles.headerRow}>
        <View style={styles.labelRow}>
          <Ionicons
            name={
              isPreNewsCrowd
                ? "cellular"
                : veracityPercent >= 60
                ? "shield-checkmark"
                : "alert-circle"
            }
            size={13}
            color={isPreNewsCrowd ? "#7C3AED" : barColor}
          />
          <Text style={styles.label}>
            {isPreNewsCrowd
              ? "H3 + DBSCAN ANOMALY TELEMETRY"
              : "NEWS + H3 BASELINE VERACITY"}
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            { borderColor: isPreNewsCrowd ? "#8B5CF6" : barColor },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: isPreNewsCrowd ? "#6D28D9" : barColor },
            ]}
          >
            {veracityStatus}
          </Text>
        </View>
      </View>

      <View style={styles.scoreRow}>
        <Text style={[styles.percentText, { color: barColor }]}>
          {veracityPercent}%
        </Text>
        <Text style={styles.summaryText} numberOfLines={2}>
          {veracitySummary}
        </Text>
        <View
          style={[
            styles.crowdWeightBadge,
            isNormalHub && styles.normalHubWeightBadge,
          ]}
        >
          <Ionicons
            name="cube-outline"
            size={10}
            color={isNormalHub ? "#475569" : "#6D28D9"}
          />
          <Text
            style={[
              styles.crowdWeightText,
              isNormalHub && { color: "#475569" },
            ]}
          >
            {isNormalHub ? "Normal Hub (0%)" : `${cwSign} H3`}
          </Text>
        </View>
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

      {/* Uber H3 Cell + DBSCAN Core vs. Normal Hub Baseline Telemetry */}
      <View style={styles.crowdRow}>
        <View style={styles.crowdPill}>
          <Ionicons name="grid-outline" size={11} color="#7C3AED" />
          <Text style={styles.crowdPillText}>
            H3 {h3Index} • {dbscanCore} core / {baselineSize} normal base ({zSign})
          </Text>
        </View>
        <View
          style={[
            styles.crowdPill,
            isStuckAnomaly ? styles.stuckPill : styles.movingPill,
          ]}
        >
          <Ionicons
            name={isStuckAnomaly ? "hand-left" : "checkmark-circle"}
            size={11}
            color={isStuckAnomaly ? "#DC2626" : "#15803D"}
          />
          <Text
            style={[
              styles.crowdPillText,
              { color: isStuckAnomaly ? "#DC2626" : "#15803D" },
            ]}
          >
            {isNormalHub
              ? `Normal Busy Crowd (Non-Threat • ${avgSpeedKmh} km/h)`
              : `${stuckPct}% STUCK • ${avgSpeedKmh} km/h (${dwellMin}m dwell)`}
          </Text>
        </View>
      </View>

      {/* Visual Stuck vs. Moving Mobile Devices Ratio Bar */}
      {!compact && (
        <View style={styles.mobilityBarWrap}>
          <View style={styles.mobilityLabelRow}>
            <Text style={styles.stuckLabel}>
              🛑 DBSCAN Stuck Core ({stuckPct}%)
            </Text>
            <Text style={styles.movingLabel}>
              🟢 Moving / Ambient ({movingPct}%)
            </Text>
          </View>
          <View style={styles.mobilityTrack}>
            <View
              style={[
                styles.mobilityStuckFill,
                { width: `${Math.min(100, Math.max(5, stuckPct))}%` },
              ]}
            />
          </View>
        </View>
      )}

      {/* Interactive H3 Mobility Signal Controls */}
      {onCrowdVote && (
        <View style={styles.voteRow}>
          <TouchableOpacity
            onPress={() => onCrowdVote("confirm")}
            style={styles.confirmVoteBtn}
          >
            <Ionicons name="cellular" size={12} color="#B91C1C" />
            <Text style={styles.confirmVoteText}>
              🛑 Stuck Anomaly (+σ Above Base)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onCrowdVote("clear")}
            style={styles.clearVoteBtn}
          >
            <Ionicons name="speedometer-outline" size={12} color="#15803D" />
            <Text style={styles.clearVoteText}>🟢 Normal Hub Flow</Text>
          </TouchableOpacity>
        </View>
      )}

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
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: "#FFFFFF",
  },
  badgeText: {
    fontSize: 9.5,
    fontWeight: "800",
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  percentText: {
    fontSize: 17,
    fontWeight: "800",
  },
  summaryText: {
    color: "#334155",
    fontSize: 11.5,
    fontWeight: "600",
    flex: 1,
  },
  crowdWeightBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#F3E8FF",
    borderColor: "#D8B4FE",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  normalHubWeightBadge: {
    backgroundColor: "#F1F5F9",
    borderColor: "#CBD5E1",
  },
  crowdWeightText: {
    color: "#6D28D9",
    fontSize: 10,
    fontWeight: "800",
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
  crowdRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 7,
  },
  crowdPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
  },
  stuckPill: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  movingPill: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  crowdPillText: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "700",
  },
  mobilityBarWrap: {
    marginTop: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 7,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  mobilityLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  stuckLabel: {
    color: "#DC2626",
    fontSize: 10,
    fontWeight: "800",
  },
  movingLabel: {
    color: "#15803D",
    fontSize: 10,
    fontWeight: "800",
  },
  mobilityTrack: {
    height: 6,
    backgroundColor: "#22C55E",
    borderRadius: 999,
    overflow: "hidden",
  },
  mobilityStuckFill: {
    height: "100%",
    backgroundColor: "#EF4444",
  },
  voteRow: {
    flexDirection: "row",
    gap: 7,
    marginTop: 8,
  },
  confirmVoteBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
  },
  confirmVoteText: {
    color: "#B91C1C",
    fontSize: 10.5,
    fontWeight: "800",
  },
  clearVoteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearVoteText: {
    color: "#15803D",
    fontSize: 10.5,
    fontWeight: "800",
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
