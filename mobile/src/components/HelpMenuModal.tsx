import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n";
import { requestMultiRadioPermissionsAsync } from "../services/bleCrowdScanner";

interface HelpMenuModalProps {
  visible: boolean;
  onClose: () => void;
  onRefreshAfterPermissions?: () => void;
}

const HEATMAP_TIERS = [
  { key: "scaleTier1" as const, color: "#FCD34D", border: "#F59E0B" },
  { key: "scaleTier2" as const, color: "#F59E0B", border: "#D97706" },
  { key: "scaleTier3" as const, color: "#EA580C", border: "#C2410C" },
  { key: "scaleTier4" as const, color: "#DC2626", border: "#991B1B" },
  { key: "scaleTier5" as const, color: "#450A0A", border: "#7F1D1D" },
];

export const HelpMenuModal: React.FC<HelpMenuModalProps> = ({
  visible,
  onClose,
  onRefreshAfterPermissions,
}) => {
  const { lang, setLang, t } = useI18n();
  const [permChecked, setPermChecked] = useState(false);

  const features = [
    { icon: "shield-checkmark-outline" as const, title: t("feat1Title"), desc: t("feat1Desc") },
    { icon: "navigate-outline" as const, title: t("feat2Title"), desc: t("feat2Desc") },
    { icon: "radio-outline" as const, title: t("feat3Title"), desc: t("feat3Desc") },
    { icon: "analytics-outline" as const, title: t("feat4Title"), desc: t("feat4Desc") },
    { icon: "location-outline" as const, title: t("feat5Title"), desc: t("feat5Desc") },
  ];

  const howItWorks = [
    { title: t("how1Title"), desc: t("how1Desc") },
    { title: t("how2Title"), desc: t("how2Desc") },
    { title: t("how3Title"), desc: t("how3Desc") },
    { title: t("how4Title"), desc: t("how4Desc") },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t("menuTitle")}</Text>
              <Text style={styles.subtitle}>{t("menuSubtitle")}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel="Close menu"
            >
              <Ionicons name="close" size={20} color="#334155" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollBody}>
            {/* Language Switcher */}
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.rowGap}>
                  <Ionicons name="language-outline" size={18} color="#1A73E8" />
                  <Text style={styles.sectionTitle}>{t("languageTitle")}</Text>
                </View>
                <View style={styles.langToggle}>
                  <TouchableOpacity
                    onPress={() => setLang("en")}
                    style={[styles.langBtn, lang === "en" && styles.langBtnActive]}
                  >
                    <Text style={[styles.langText, lang === "en" && styles.langTextActive]}>
                      English
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setLang("bn")}
                    style={[styles.langBtn, lang === "bn" && styles.langBtnActive]}
                  >
                    <Text style={[styles.langText, lang === "bn" && styles.langTextActive]}>
                      বাংলা
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Features List */}
            <Text style={styles.groupHeading}>{t("featuresHeading")}</Text>
            <View style={styles.card}>
              {features.map((f, i) => (
                <View
                  key={f.title}
                  style={[styles.itemRow, i < features.length - 1 && styles.itemDivider]}
                >
                  <View style={styles.iconCircle}>
                    <Ionicons name={f.icon} size={17} color="#1A73E8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{f.title}</Text>
                    <Text style={styles.itemDesc}>{f.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* How Each Thing Works */}
            <Text style={styles.groupHeading}>{t("howItWorksHeading")}</Text>
            <View style={styles.card}>
              {howItWorks.map((h, i) => (
                <View
                  key={h.title}
                  style={[styles.howRow, i < howItWorks.length - 1 && styles.itemDivider]}
                >
                  <Text style={styles.itemTitle}>{h.title}</Text>
                  <Text style={styles.itemDesc}>{h.desc}</Text>
                </View>
              ))}
            </View>

            {/* Heatmap Density Color Thresholds */}
            <Text style={styles.groupHeading}>{t("heatmapScaleHeading")}</Text>
            <View style={styles.card}>
              <Text style={styles.scaleSub}>{t("heatmapScaleSub")}</Text>
              {HEATMAP_TIERS.map((tier) => (
                <View key={tier.key} style={styles.tierRow}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: tier.color, borderColor: tier.border },
                    ]}
                  />
                  <Text style={styles.tierText}>{t(tier.key)}</Text>
                </View>
              ))}
            </View>

            {/* Sensor Permissions Check */}
            <TouchableOpacity
              onPress={async () => {
                await requestMultiRadioPermissionsAsync();
                setPermChecked(true);
                onRefreshAfterPermissions?.();
              }}
              style={styles.permBtn}
            >
              <Ionicons name="hardware-chip-outline" size={17} color="#1D4ED8" />
              <Text style={styles.permBtnText}>
                {permChecked ? t("permissionsDone") : t("permissionsBtn")}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#F8FAFC",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  subtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollBody: {
    paddingBottom: 24,
    gap: 10,
  },
  groupHeading: {
    fontSize: 12.5,
    fontWeight: "800",
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 6,
    marginLeft: 2,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowGap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#0F172A",
  },
  langToggle: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  langBtnActive: {
    backgroundColor: "#1A73E8",
  },
  langText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  langTextActive: {
    color: "#FFFFFF",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 8,
  },
  howRow: {
    paddingVertical: 8,
  },
  itemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  itemTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 2,
  },
  itemDesc: {
    fontSize: 12,
    lineHeight: 17.5,
    color: "#475569",
  },
  scaleSub: {
    fontSize: 11.5,
    color: "#64748B",
    marginBottom: 8,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 5,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
  },
  tierText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: "#1E293B",
  },
  permBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  permBtnText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#1D4ED8",
  },
});
