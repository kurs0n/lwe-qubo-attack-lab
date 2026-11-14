"""Visualize a small LWE instance and its QUBO solver results."""

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import ListedColormap, TwoSlopeNorm

from lwe_qubo.crypto.generator import generate_lwe_instance
from lwe_qubo.qubo.converter import lwe_to_qubo
from lwe_qubo.solvers import SimulatedAnnealingSolver, TabuSearchSolver


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--n",
        type=int,
        default=8,
        help="Secret length, from 4 to 12 (default: 8)",
    )
    parser.add_argument(
        "--m",
        type=int,
        default=None,
        help="Number of observations (default: 2*n)",
    )
    parser.add_argument(
        "--noise-bound",
        type=int,
        default=2,
        help="Sample noise uniformly from [-bound, bound] (default: 2)",
    )
    parser.add_argument("--seed", type=int, default=7, help="Random seed (default: 7)")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("lwe_qubo_visualization.png"),
        help="PNG output path (default: lwe_qubo_visualization.png)",
    )
    args = parser.parse_args()
    if not 4 <= args.n <= 12:
        parser.error("n must be between 4 and 12 to keep the exhaustive landscape readable")
    observation_count = args.m if args.m is not None else 2 * args.n
    if observation_count < args.n:
        parser.error("m must be greater than or equal to n")
    if args.noise_bound < 0:
        parser.error("noise-bound must be non-negative")
    if not 0 <= args.seed <= np.iinfo(np.uint32).max:
        parser.error("seed must be between 0 and 2**32 - 1")

    instance = generate_lwe_instance(
        n=args.n,
        m=observation_count,
        noise_bound=args.noise_bound,
        seed=args.seed,
    )
    qubo = lwe_to_qubo(instance.A, instance.b)

    annealing = SimulatedAnnealingSolver(num_sweeps=1000).solve(
        qubo,
        num_reads=100,
        seed=args.seed,
        true_secret=instance.secret,
    )
    tabu = TabuSearchSolver(num_restarts=1000).solve(
        qubo,
        num_reads=100,
        seed=args.seed,
        true_secret=instance.secret,
    )

    candidates = [
        np.array([(state >> bit) & 1 for bit in range(instance.n)], dtype=np.int8)
        for state in range(1 << instance.n)
    ]
    energies = np.array([qubo.energy(candidate) for candidate in candidates])

    figure, axes = plt.subplots(
        1,
        3,
        figsize=(17, 5),
        gridspec_kw={"width_ratios": [1.35, 1.0, 1.0]},
    )
    figure.suptitle(
        rf"Noisy LWE $\rightarrow$ QUBO (n={instance.n}, m={instance.m}, "
        rf"noise bound={args.noise_bound})",
        fontsize=15,
    )

    energy_axis, qubo_axis, solution_axis = axes
    states = np.arange(len(candidates))
    energy_axis.scatter(states, energies, s=14, color="#94a3b8", alpha=0.75)
    markers = [
        ("Secret", instance.secret, "#16a34a", "*"),
        ("Simulated annealing", annealing.solution, "#ea580c", "o"),
        ("Tabu search", tabu.solution, "#7c3aed", "D"),
    ]
    offsets = [-0.2, 0.0, 0.2]
    for (name, solution, color, marker), offset in zip(markers, offsets):
        state = sum(int(bit) << index for index, bit in enumerate(solution))
        energy_axis.scatter(
            state + offset,
            energies[state],
            color=color,
            marker=marker,
            s=110,
            zorder=3,
            label=name,
        )
    energy_axis.axhline(
        float(np.min(energies)),
        color="#475569",
        linestyle="--",
        linewidth=1,
        label=f"Minimum energy ({np.min(energies):.2f})",
    )
    tick_states = np.linspace(0, len(candidates) - 1, num=min(9, len(candidates)), dtype=int)
    energy_axis.set(
        title=f"Energy landscape ({len(candidates)} candidates)",
        xlabel="Candidate state (binary)",
        ylabel="QUBO energy",
        xticks=tick_states,
        xticklabels=[format(state, f"0{instance.n}b") for state in tick_states],
    )
    energy_axis.tick_params(axis="x", labelrotation=45)
    energy_axis.legend(fontsize=7)
    energy_axis.grid(axis="y", alpha=0.25)

    matrix = qubo.matrix
    scale = max(float(np.max(np.abs(matrix))), 1.0)
    image = qubo_axis.imshow(
        matrix,
        cmap="RdBu_r",
        norm=TwoSlopeNorm(vmin=-scale, vcenter=0.0, vmax=scale),
    )
    for row in range(instance.n):
        for column in range(instance.n):
            qubo_axis.text(
                column,
                row,
                f"{matrix[row, column]:.1f}",
                ha="center",
                va="center",
                fontsize=8,
            )
    qubo_axis.set(
        title="Upper-triangular QUBO matrix",
        xlabel="Variable",
        ylabel="Variable",
        xticks=range(instance.n),
        yticks=range(instance.n),
        xticklabels=[f"s{i}" for i in range(instance.n)],
        yticklabels=[f"s{i}" for i in range(instance.n)],
    )
    figure.colorbar(image, ax=qubo_axis, fraction=0.046, pad=0.04)

    solutions = np.array([instance.secret, annealing.solution, tabu.solution])
    solution_axis.imshow(
        solutions,
        cmap=ListedColormap(["#e2e8f0", "#2563eb"]),
        vmin=0,
        vmax=1,
        aspect="auto",
    )
    for row in range(solutions.shape[0]):
        for column in range(solutions.shape[1]):
            solution_axis.text(
                column,
                row,
                str(solutions[row, column]),
                ha="center",
                va="center",
                color="white" if solutions[row, column] else "#0f172a",
            )
    solution_axis.set(
        title="Recovered bits",
        xlabel="Variable",
        xticks=range(instance.n),
        yticks=range(3),
        xticklabels=[f"s{i}" for i in range(instance.n)],
        yticklabels=["Secret", "Annealing", "Tabu"],
    )

    figure.tight_layout()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(args.output, dpi=160, bbox_inches="tight")

    print(f"Secret:                {instance.secret.tolist()}")
    print(f"Noise:                 {instance.error.tolist()}")
    print(f"Secret energy:          {qubo.energy(instance.secret):.3f}")
    print(f"Simulated annealing:   {annealing.solution} (energy={annealing.energy:.3f})")
    print(f"Tabu search:           {tabu.solution} (energy={tabu.energy:.3f})")
    print(f"Plot saved to:         {args.output}")
    plt.show()


if __name__ == "__main__":
    main()
