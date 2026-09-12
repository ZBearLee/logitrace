"""ETA 预测：特征工程 + GradientBoosting 回归 + 逐运输方式基线对比。

设计口径：
- 目标值 = 延误小时数（actual_arrival - planned_arrival），预测时 ETA = 计划到达 + 预测延误。
  直接回归「延误」而不是「绝对到达时间」，让模型专注学"偏了多少"，季节/月份效应进特征。
- 基线 = 每种运输方式的延误中位数：任何模型必须先跑赢它才有存在意义，
  两者 MAE 一起存进产物，便于对比模型相对基线的收益。
- 产物（模型 + 基线 + 指标）落盘为 joblib，服务侧懒加载；文件不存在 = ETA 功能降级隐藏。

样本量说明：当前数据只有几十条已评分运单，GBR 在这个量级必然偏拟合；
但链路（特征→训练→落盘→服务化→偏差告警）已闭环，接真实历史数据后无需改动。
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor

MODES = ("sea", "road", "air", "rail")
# 特征顺序即向量顺序，预测与训练必须严格一致
FEATURE_NAMES = [
    "distance_km",
    "planned_duration_h",
    "month",
    "is_sea",
    "is_road",
    "is_air",
    "is_rail",
    "carrier_avg_speed",
]
ARTIFACT_PATH = Path(__file__).parent / "artifacts" / "eta_model.joblib"


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点球面距离（km）。特征里比"起止港 code"更有泛化力。"""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def build_features(
    distance_km: float,
    planned_duration_h: float,
    planned_arrival: datetime,
    mode: str,
    carrier_avg_speed: float | None,
) -> list[float]:
    """单条样本的特征向量：航线距离 / 计划时长 / 月份 / 方式 one-hot / 承运商均速。"""
    return [
        distance_km,
        planned_duration_h,
        planned_arrival.month,
        *(1.0 if mode == m else 0.0 for m in MODES),
        carrier_avg_speed or 0.0,
    ]


def train(dataset: list[dict]) -> dict:
    """dataset 每项：{features: list[float], delay_hours: float, mode: str}。

    返回可直接落盘的产物字典（模型 + 基线 + 指标）。
    """
    if len(dataset) < 8:
        raise ValueError(f"训练样本不足（{len(dataset)} < 8），先跑模拟器积累历史运单")

    x = np.array([d["features"] for d in dataset])
    y = np.array([d["delay_hours"] for d in dataset])

    # 基线：逐方式延误中位数（没有模型时的朴素预测）
    baseline: dict[str, float] = {}
    for m in MODES:
        vals = [d["delay_hours"] for d in dataset if d["mode"] == m]
        baseline[m] = float(np.median(vals)) if vals else float(np.median(y))
    baseline_pred = np.array([baseline[d["mode"]] for d in dataset])
    mae_baseline = float(np.mean(np.abs(y - baseline_pred)))

    model = GradientBoostingRegressor(random_state=42)
    model.fit(x, y)
    mae_model = float(np.mean(np.abs(y - model.predict(x))))

    # 每种方式的样本量 → 服务化时换算预测置信度（样本越少越保守）
    counts = {m: sum(1 for d in dataset if d["mode"] == m) for m in MODES}

    return {
        "model": model,
        "feature_names": FEATURE_NAMES,
        "baseline": baseline,
        "counts": counts,
        "mae_baseline_h": round(mae_baseline, 2),
        "mae_model_h": round(mae_model, 2),
        "n_samples": len(dataset),
    }


def save(artifact: dict, version: str) -> None:
    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({**artifact, "version": version}, ARTIFACT_PATH)


def load() -> dict | None:
    """懒加载产物；文件不存在返回 None（= ETA 功能降级，前端隐藏入口）。"""
    if not ARTIFACT_PATH.exists():
        return None
    return joblib.load(ARTIFACT_PATH)


def predict_delay_hours(artifact: dict, features: list[float]) -> float:
    """模型预测延误小时数，截到非负：业务上"提前很久到"不是我们要预测的方向。"""
    pred = artifact["model"].predict(np.array([features]))[0]
    return max(0.0, float(pred))


def baseline_delay_hours(artifact: dict, mode: str) -> float:
    return max(0.0, float(artifact["baseline"].get(mode, 0.0)))


def confidence_for(artifact: dict, mode: str) -> float:
    """置信度：该方式样本越足越高，30 条到顶 0.9，样本不足给 0.3 起步的保守值。"""
    n = artifact.get("counts", {}).get(mode, 0)
    return round(min(0.9, 0.3 + n / 100), 2)


def metrics_json(artifact: dict) -> str:
    return json.dumps(
        {
            "mae_baseline_h": artifact["mae_baseline_h"],
            "mae_model_h": artifact["mae_model_h"],
            "n_samples": artifact["n_samples"],
            "baseline": artifact["baseline"],
        },
        ensure_ascii=False,
    )
