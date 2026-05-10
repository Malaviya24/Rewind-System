import { useEffect, useRef, useState } from "react";
import { Image, Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { MotorMedia } from "@/models/types";
import { colors } from "@/theme/colors";
import { spacing } from "@/theme/theme";

const MIN_SCALE = 1;
const MAX_SCALE = 3;

type Props = {
  media: MotorMedia[];
  visible: boolean;
  initialIndex?: number;
  onClose: () => void;
};

export function MediaViewer({ media, visible, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(MIN_SCALE);
  const [autoSwipe, setAutoSwipe] = useState(false);
  const current = media[index];
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(MIN_SCALE);
  const latestScale = useRef(MIN_SCALE);
  const zoomed = scale > 1.05;
  const player = useVideoPlayer(current?.mediaType === "video" ? current.uri : null, (video) => {
    video.loop = true;
  });

  useEffect(() => {
    if (visible) {
      setIndex(Math.min(initialIndex, Math.max(media.length - 1, 0)));
      setScale(MIN_SCALE);
      setAutoSwipe(false);
    }
  }, [initialIndex, media.length, visible]);

  useEffect(() => {
    latestScale.current = scale;
  }, [scale]);

  useEffect(() => {
    if (!visible || !autoSwipe || media.length < 2 || zoomed) {
      return;
    }
    const timer = setInterval(() => {
      move(1);
    }, 2600);
    return () => clearInterval(timer);
  }, [autoSwipe, media.length, visible, zoomed]);

  function move(delta: number) {
    if (!media.length) {
      return;
    }
    setScale(MIN_SCALE);
    setIndex((value) => (value + delta + media.length) % media.length);
  }

  function toggleZoom() {
    setAutoSwipe(false);
    setScale((value) => (value > 1.05 ? MIN_SCALE : 2.2));
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event, gesture) => {
        if (event.nativeEvent.touches.length >= 2) {
          return true;
        }
        return Math.abs(gesture.dx) > 18 && Math.abs(gesture.dy) < 30;
      },
      onPanResponderGrant: (event) => {
        if (event.nativeEvent.touches.length >= 2) {
          pinchStartDistance.current = touchDistance(event.nativeEvent.touches);
          pinchStartScale.current = latestScale.current;
          setAutoSwipe(false);
        }
      },
      onPanResponderMove: (event) => {
        if (event.nativeEvent.touches.length < 2 || !pinchStartDistance.current) {
          return;
        }
        const nextDistance = touchDistance(event.nativeEvent.touches);
        const nextScale = clamp((pinchStartScale.current * nextDistance) / pinchStartDistance.current, MIN_SCALE, MAX_SCALE);
        setScale(nextScale);
      },
      onPanResponderRelease: (_, gesture) => {
        pinchStartDistance.current = 0;
        if (Math.abs(gesture.dx) < Math.abs(gesture.dy)) {
          return;
        }
        if (gesture.dx > 44 && latestScale.current <= 1.05) {
          move(-1);
        }
        if (gesture.dx < -44 && latestScale.current <= 1.05) {
          move(1);
        }
        if (latestScale.current <= 1.05) {
          setScale(MIN_SCALE);
        }
      }
    })
  ).current;

  return (
    <Modal animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.viewer}>
        <View style={styles.top}>
          <Text style={styles.counter}>
            {index + 1} / {media.length}
          </Text>
          <View style={styles.topActions}>
            {media.length > 1 ? (
              <Pressable onPress={() => setAutoSwipe((value) => !value)} style={[styles.iconButton, autoSwipe && styles.iconButtonActive]}>
                <Ionicons name={autoSwipe ? "pause" : "play"} size={22} color={colors.white} />
              </Pressable>
            ) : null}
            {current?.mediaType === "image" ? (
              <Pressable onPress={toggleZoom} style={styles.iconButton}>
                <Ionicons name={zoomed ? "contract" : "expand"} size={22} color={colors.white} />
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.iconButton}>
              <Ionicons name="close" size={28} color={colors.white} />
            </Pressable>
          </View>
        </View>
        <View style={styles.stage} {...panResponder.panHandlers}>
          {current?.mediaType === "video" ? (
            <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
          ) : current ? (
            <Pressable onPress={toggleZoom} style={styles.imageFrame}>
              <Image source={{ uri: current.uri }} style={[styles.image, { transform: [{ scale }] }]} />
            </Pressable>
          ) : null}
        </View>
        {media.length > 1 ? (
          <View style={styles.controls}>
            <Pressable onPress={() => move(-1)} style={styles.round}>
              <Ionicons name="chevron-back" size={26} color={colors.white} />
            </Pressable>
            <Pressable onPress={() => move(1)} style={styles.round}>
              <Ionicons name="chevron-forward" size={26} color={colors.white} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function touchDistance(touches: Array<{ pageX: number; pageY: number }>) {
  const [first, second] = touches;
  if (!first || !second) {
    return 0;
  }
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}

const styles = StyleSheet.create({
  viewer: {
    flex: 1,
    backgroundColor: "#080A0F"
  },
  top: {
    paddingTop: 54,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  counter: {
    color: colors.white,
    fontWeight: "900"
  },
  topActions: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center"
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)"
  },
  iconButtonActive: {
    backgroundColor: colors.accentDeep
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    overflow: "hidden"
  },
  image: {
    width: "100%",
    height: "100%",
    resizeMode: "contain"
  },
  imageFrame: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center"
  },
  video: {
    width: "100%",
    height: "100%"
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xl,
    paddingBottom: 40
  },
  round: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentDeep
  }
});
