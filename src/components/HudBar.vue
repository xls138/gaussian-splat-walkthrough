<template>
  <div class="hud">
    <div class="hud-left">
      <div class="hud-card">
        <div class="hud-meta">
          <span class="hud-state">{{ roomState }}</span>
          <div class="eyebrow">Company <span style="color: #8ff4df;">RoomTour</span></div>
          <div class="eyebrow-roomtitle">{{ roomTitle }}</div>
        </div>
      </div>
    </div>
    <div class="hud-room-title-container">
      <div class="hud-room-location">Current Map</div>
      <div class="hud-room-title">
        {{ roomTitle }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  roomTitle: string;
  roomState: string;
  resourceTier: string;
}>();
</script>
