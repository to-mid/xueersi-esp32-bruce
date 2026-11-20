#pragma once

// Right-align as many icons as fit after the label and before the battery.
struct StatusIconLayout {
    int start;
    int count;
};

inline StatusIconLayout statusIconLayout(int labelEnd, int right, int requested) {
    constexpr int width = 16;
    constexpr int gap = 6;
    const int left = labelEnd + gap;
    const int available = right > left ? right - left : 0;
    const int capacity = (available + gap) / (width + gap);
    const int count = requested < capacity ? requested : capacity;
    const int total = count > 0 ? count * width + (count - 1) * gap : 0;
    return {right - total, count};
}
