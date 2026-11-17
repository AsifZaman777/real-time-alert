import React from "react";
import {
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GoldAlert } from "../types/alert";
import { VeracityMeter } from "./VeracityMeter";

interface AreaDetailModalProps {
  visible: boolean;
  areaName: string | null;
  alerts: GoldAlert[];
  onClose: () => void;
}

export const AreaDetailModal: React.FC<AreaDetailModalProps> = ({
  visible,
  areaName,
  alerts,
  onClose,
}) => {
  if (!areaName) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>AREA DISRUPTION INTEL</Text>
              <Text style={styles.title}>{areaName}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color="#E2E8F0" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {alerts.length === 0 ? (
              <Text style={styles.empty}>No disruption alerts recorded for {areaName}.</Text>
            ) : (
              alerts.map((cluster) => {
                const isRed = cluster.color === "#EF4444";
                return (
                  <View
                    key={cluster.cluster_id}
                    style={[
                      styles.clusterCard,
                      { borderLeftColor: cluster.color, borderLeftWidth: 4 },
                    ]}
                  >
                    <View style={styles.clusterHeader}>
                      <View
                        style={[
                          styles.eventPill,
                          {
                            backgroundColor: isRed
                              ? "rgba(239,68,68,0.18)"
                              : "rgba(245,158,11,0.18)",
                          },
                        ]}
                      >
                        <Text style={[styles.eventPillText, { color: cluster.color }]}>
                          {cluster.event_type.toUpperCase()} • {cluster.severity}
                        </Text>
                      </View>
                      {cluster.on_route && (
                        <View style={styles.routeBadge}>
                          <Text style={styles.routeBadgeText}>ON YOUR ROUTE</Text>
                        </View>
                      )}
                    </View>

                    <VeracityMeter
                      veracityPercent={cluster.veracity_percent}
                      credibilityScore={cluster.credibility_score}
                      veracityStatus={cluster.veracity_status}
                      veracitySummary={cluster.veracity_summary}
                      sources={cluster.sources}
                    />

                    <Text style={styles.headlinesTitle}>
                      Headlines ({cluster.articles.length})
                    </Text>

                    {cluster.articles.map((art, idx) => (
                      <TouchableOpacity
                        key={`${cluster.cluster_id}-${idx}`}
                        style={styles.articleRow}
                        onPress={() => {
                          if (art.url) Linking.openURL(art.url).catch(() => {});
                        }}
                      >
                        <View style={styles.articleMeta}>
                          <Text style={styles.articleSource}>{art.source}</Text>
                          <Text style={styles.articleLang}>
                            {art.lang?.toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.articleHeadline}>{art.headline}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.72)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0B1120",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "82%",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: "#1E293B",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  kicker: {
    color: "#38BDF8",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "800",
  },
  closeBtn: {
    backgroundColor: "#1E293B",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  closeText: {
    color: "#E2E8F0",
    fontWeight: "600",
    fontSize: 13,
  },
  scroll: {
    flexGrow: 0,
  },
  empty: {
    color: "#94A3B8",
    textAlign: "center",
    paddingVertical: 24,
  },
  clusterCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  clusterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  eventPill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eventPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  routeBadge: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderColor: "#EF4444",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  routeBadgeText: {
    color: "#FCA5A5",
    fontSize: 10,
    fontWeight: "800",
  },
  headlinesTitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  articleRow: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    padding: 9,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  articleMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  articleSource: {
    color: "#38BDF8",
    fontSize: 11,
    fontWeight: "700",
  },
  articleLang: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
  },
  articleHeadline: {
    color: "#F1F5F9",
    fontSize: 13,
    lineHeight: 18,
  },
});
