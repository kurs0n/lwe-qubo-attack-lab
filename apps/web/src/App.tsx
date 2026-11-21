import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { SolverStep } from "@lwe-qubo/core";
import type {
  RunSolverMessage,
  SolverName,
  WorkerOutput,
} from "./worker-protocol";

interface RunOutput {
  readonly instance: {
    readonly A: readonly (readonly number[])[];
    readonly b: readonly number[];
    readonly n: number;
    readonly m: number;
    readonly noiseBound: number;
  };
  readonly qubo: {
    readonly matrix: readonly (readonly number[])[];
    readonly offset: number;
  };
  readonly result: {
    readonly solution: readonly number[];
    readonly energy: number;
    readonly executionTimeMs: number;
    readonly isCorrect: boolean | null;
    readonly hammingDistance: number | null;
    readonly extraInfo: Readonly<Record<string, number | string | boolean>>;
  };
}

const solverLabels: Record<SolverName, string> = {
  bruteForce: "Brute force",
  simulatedAnnealing: "Symulowane wyżarzanie",
  tabuSearch: "Tabu search",
};

function App(): React.JSX.Element {
  const workerRef = useRef<Worker | null>(null);
  const nextRunId = useRef(0);
  const [n, setN] = useState(8);
  const [m, setM] = useState(16);
  const [noiseBound, setNoiseBound] = useState(1);
  const [seed, setSeed] = useState(7);
  const [solver, setSolver] = useState<SolverName>("bruteForce");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<RunOutput | null>(null);
  const [trace, setTrace] = useState<readonly SolverStep[]>([]);
  const [activeTraceIndex, setActiveTraceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveTraceIndex((current) =>
        Math.min(current + 1, trace.length - 1),
      );
    }, 750);
    return () => window.clearInterval(timer);
  }, [isPlaying, trace.length]);

  useEffect(() => {
    if (isPlaying && activeTraceIndex >= trace.length - 1) {
      setIsPlaying(false);
    }
  }, [activeTraceIndex, isPlaying, trace.length]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    const runId = nextRunId.current + 1;
    nextRunId.current = runId;
    const message: RunSolverMessage = {
      type: "run",
      runId,
      n,
      m,
      noiseBound,
      seed,
      solver,
    };

    setOutput(null);
    setTrace([]);
    setActiveTraceIndex(0);
    setIsPlaying(false);
    setProgress(0);
    setError(null);
    setNotice(null);
    setRunning(true);
    worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
      if (event.data.runId !== runId) {
        return;
      }
      if (event.data.type === "progress") {
        setProgress(
          event.data.progress.total === 0
            ? 0
            : event.data.progress.completed / event.data.progress.total,
        );
      } else if (event.data.type === "trace") {
        const steps = event.data.steps;
        setTrace((current) => [...current, ...steps]);
      } else if (event.data.type === "done") {
        setOutput({
          instance: event.data.instance,
          qubo: event.data.qubo,
          result: event.data.result,
        });
        setProgress(1);
        setRunning(false);
        worker.terminate();
        workerRef.current = null;
      } else if (event.data.type === "cancelled") {
        setRunning(false);
        setNotice("Obliczenia anulowane.");
        worker.terminate();
        workerRef.current = null;
      } else {
        setRunning(false);
        setError(event.data.message);
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = (workerError: ErrorEvent) => {
      setRunning(false);
      setError(workerError.message || "Wystąpił błąd workera.");
      worker.terminate();
      workerRef.current = null;
    };
    worker.postMessage(message);
  }

  function cancel(): void {
    const worker = workerRef.current;
    if (worker === null) {
      return;
    }
    worker.postMessage({ type: "cancel", runId: nextRunId.current });
  }

  const progressPercent = Math.round(progress * 100);
  const activeStep = trace[activeTraceIndex] ?? null;
  const chart = getChartData(trace, activeTraceIndex);
  const totalIterations = output
    ? getTotalIterations(solver, output.instance.n, output.result.extraInfo)
    : 0;

  return (
    <main className="page-shell">
      <header className="hero">
        <p className="eyebrow">Laboratorium interaktywne · LWE → QUBO</p>
        <h1>Jak odzyskać ukryty klucz?</h1>
        <p className="hero-copy">
          Zobacz, jak obserwacje z błędem zamieniają się w funkcję energii i jak
          różne algorytmy szukają jej minimum. Klucz pozostaje ukryty.
        </p>
      </header>

      <section className="story-panel" aria-label="Wprowadzenie do redukcji">
        <div>
          <p className="eyebrow">Cel ataku</p>
          <h2>Od obserwacji do krajobrazu energii</h2>
        </div>
        <p>
          Znamy macierz <code>A</code> i wektor <code>b</code>, ale nie sekret{" "}
          <code>s</code>. Szukamy binarnego wektora, który minimalizuje błąd
          rekonstrukcji:
        </p>
        <pre className="formula">minₛ ∈ &#123;0,1&#125;ⁿ ‖As − b‖² = sᵀQs + ‖b‖²</pre>
        <p className="muted">
          Wybierz mały rozmiar, uruchom solver i porównaj jego ślad z minimum
          znalezionym przez przeszukanie wszystkich 2ⁿ stanów.
        </p>
      </section>

      <section className="panel controls-panel" aria-labelledby="controls-title">
        <div>
          <p className="eyebrow">Eksperyment</p>
          <h2 id="controls-title">Wygeneruj instancję</h2>
        </div>
        <form className="controls" onSubmit={handleSubmit}>
          <label>
            Liczba bitów n
            <input
              type="number"
              min={4}
              max={16}
              value={n}
              disabled={running}
              onChange={(event) => {
                const nextN = Number(event.target.value);
                setN(nextN);
                setM((currentM) => Math.max(currentM, nextN));
              }}
              required
            />
          </label>
          <label>
            Obserwacje m
            <input
              type="number"
              min={n}
              max={256}
              value={m}
              disabled={running}
              onChange={(event) => setM(Number(event.target.value))}
              required
            />
          </label>
          <label>
            Granica szumu
            <input
              type="number"
              min={0}
              max={20}
              value={noiseBound}
              disabled={running}
              onChange={(event) => setNoiseBound(Number(event.target.value))}
              required
            />
          </label>
          <label>
            Seed
            <input
              type="number"
              min={0}
              max={4_294_967_295}
              value={seed}
              disabled={running}
              onChange={(event) => setSeed(Number(event.target.value))}
              required
            />
          </label>
          <label className="solver-select">
            Solver
            <select
              value={solver}
              disabled={running}
              onChange={(event) => {
                const value = event.target.value;
                if (isSolverName(value)) {
                  setSolver(value);
                }
              }}
            >
              {Object.entries(solverLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {running ? (
            <button className="button button-secondary" type="button" onClick={cancel}>
              Anuluj
            </button>
          ) : (
            <button className="button" type="submit">
              Uruchom eksperyment
            </button>
          )}
        </form>

        {running && (
          <div className="progress-area" aria-live="polite">
            <div className="progress-label">
              <span>Solver pracuje w Web Workerze</span>
              <span>{progressPercent}%</span>
            </div>
            <progress max={100} value={progressPercent} />
          </div>
        )}
        {notice && <p className="notice" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {output && (
        <section className="results-grid" aria-live="polite">
          <article className="panel result-card">
            <p className="eyebrow">Wynik · {solverLabels[solver]}</p>
            <h2>
              Energia <span className="accent">{output.result.energy.toFixed(3)}</span>
            </h2>
            <dl className="metrics">
              <div>
                <dt>Czas solvera</dt>
                <dd>{output.result.executionTimeMs.toFixed(2)} ms</dd>
              </div>
              <div>
                <dt>Odzyskano klucz</dt>
                <dd>{output.result.isCorrect ? "Tak" : "Nie"}</dd>
              </div>
              <div>
                <dt>Odległość Hamminga</dt>
                <dd>{output.result.hammingDistance ?? "—"}</dd>
              </div>
              <div>
                <dt>Przestrzeń stanów</dt>
                <dd>2<sup>{output.instance.n}</sup></dd>
              </div>
            </dl>
            <p className="muted">
              Rozwiązanie solvera:{" "}
              <code>{output.result.solution.join("")}</code>
            </p>
          </article>

          <article className="panel trace-card">
            <p className="eyebrow">Trajektoria</p>
            <h2>Energia w kolejnych krokach</h2>
            {chart ? (
              <svg
                className="trace-chart"
                viewBox="0 0 640 220"
                role="img"
                aria-label="Wykres energii w kolejnych krokach solvera"
              >
                <line x1="24" y1="196" x2="624" y2="196" className="chart-axis" />
                <polyline points={chart.points} className="energy-line" />
                {chart.currentPoint && (
                  <circle
                    cx={chart.currentPoint.x}
                    cy={chart.currentPoint.y}
                    r="6"
                    className="active-energy-point"
                  />
                )}
              </svg>
            ) : (
              <p className="muted">Solver nie zwrócił kroków do wykresu.</p>
            )}
            <p className="muted">
              Pokazano {trace.length} próbek śladu; minimum{" "}
              {trace.length > 0
                ? Math.min(...trace.map((step) => step.bestEnergy)).toFixed(3)
                : "—"}
            </p>
          </article>

          <article className="panel matrix-card">
            <p className="eyebrow">Dane publiczne</p>
            <h2>Macierz A i obserwacje b</h2>
            <p className="muted">
              Atakujący widzi A i b; sekret oraz wektor błędu nie są ujawniane.
            </p>
            <div className="public-data">
              <div className="matrix-scroll">
                <table className="qubo-matrix">
                  <caption className="sr-only">Publiczna macierz A</caption>
                  <tbody>
                    {output.instance.A.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((value, columnIndex) => (
                          <td key={columnIndex}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="eyebrow">b</p>
                <div className="vector">
                  {output.instance.b.map((value, index) => (
                    <code key={index}>{value}</code>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="panel matrix-card">
            <p className="eyebrow">Redukcja</p>
            <h2>Macierz QUBO</h2>
            <p className="muted">
              A ma {output.instance.m} wierszy i {output.instance.n} kolumn.
              Stały offset: {output.qubo.offset.toFixed(2)}.
            </p>
            <div className="matrix-scroll">
              <table className="qubo-matrix">
                <caption className="sr-only">Współczynniki macierzy QUBO</caption>
                <tbody>
                  {output.qubo.matrix.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((value, columnIndex) => (
                        <td
                          key={columnIndex}
                          title={`Q[${rowIndex}, ${columnIndex}] = ${value}`}
                          style={{ backgroundColor: coefficientColor(value) }}
                        >
                          {Number(value.toFixed(1))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}

      {output && activeStep && (
        <section className="panel step-guide" aria-labelledby="step-guide-title">
          <div className="step-guide-heading">
            <p className="eyebrow">Przewodnik krok po kroku</p>
            <h2 id="step-guide-title">Co robi teraz algorytm?</h2>
            <p className="muted">
              „Stan” to aktualny zgadywany klucz. „Energia” mierzy, jak dobrze
              pasuje do obserwacji — niższa jest lepsza.
            </p>
          </div>

          <div className="step-navigation">
            <button
              className="button button-secondary"
              type="button"
              disabled={activeTraceIndex === 0}
              onClick={() => {
                setIsPlaying(false);
                setActiveTraceIndex((current) => Math.max(0, current - 1));
              }}
            >
              Poprzedni krok
            </button>
            <span className="step-count">
              Próbka {activeTraceIndex + 1} z {trace.length}
            </span>
            <button
              className="button button-secondary"
              type="button"
              disabled={activeTraceIndex >= trace.length - 1}
              onClick={() => {
                setIsPlaying(false);
                setActiveTraceIndex((current) =>
                  Math.min(trace.length - 1, current + 1),
                );
              }}
            >
              Następny krok
            </button>
            <button
              className="button"
              type="button"
              aria-pressed={isPlaying}
              disabled={trace.length < 2}
              onClick={() => setIsPlaying((playing) => !playing)}
            >
              {isPlaying ? "Zatrzymaj" : "Odtwórz"}
            </button>
          </div>

          <label className="step-slider-label">
            Przesuń, aby obejrzeć zapisane kroki
            <input
              aria-label="Krok algorytmu"
              type="range"
              min={0}
              max={trace.length - 1}
              value={activeTraceIndex}
              onChange={(event) => {
                setIsPlaying(false);
                setActiveTraceIndex(Number(event.target.value));
              }}
            />
          </label>

          <div className="step-explanation" aria-live="polite">
            <p>{explainStep(activeStep, solver, output.instance.n)}</p>
            <dl className="step-facts">
              <div>
                <dt>Numer kroku solvera</dt>
                <dd>{activeStep.iter + 1}</dd>
              </div>
              {activeStep.flipped !== null && (
                <div>
                  <dt>
                    {solver === "simulatedAnnealing"
                      ? "Próba zmiany bitu"
                      : "Zmieniony bit"}
                  </dt>
                  <dd>s{activeStep.flipped}</dd>
                </div>
              )}
              {activeStep.deltaE !== null && (
                <div>
                  <dt>Zmiana energii</dt>
                  <dd>{activeStep.deltaE.toFixed(3)}</dd>
                </div>
              )}
              <div>
                <dt>Aktualny stan</dt>
                <dd><code>{activeStep.state.join("")}</code></dd>
              </div>
              <div>
                <dt>Energia tego stanu</dt>
                <dd>{activeStep.energy.toFixed(3)}</dd>
              </div>
              <div>
                <dt>Najlepsza energia dotąd</dt>
                <dd>{activeStep.bestEnergy.toFixed(3)}</dd>
              </div>
              {activeStep.temperature !== null && (
                <div>
                  <dt>Temperatura</dt>
                  <dd>{activeStep.temperature.toFixed(3)}</dd>
                </div>
              )}
              {activeStep.tabu !== null && (
                <div>
                  <dt>Chwilowo zablokowane bity</dt>
                  <dd>
                    {activeStep.tabu.length > 0
                      ? activeStep.tabu.map((bit) => `s${bit}`).join(", ")
                      : "brak"}
                  </dd>
                </div>
              )}
            </dl>
            {totalIterations > trace.length && (
              <p className="muted">
                Pokazujemy {trace.length} zapisanych momentów z {totalIterations}{" "}
                kroków; długi ślad jest próbkowany, ale każde poprawienie
                najlepszego wyniku zostaje zachowane.
                {solver === "bruteForce" &&
                  " Brute force mimo to sprawdza wszystkie pominięte stany."}
              </p>
            )}
          </div>
        </section>
      )}

      <footer>
        Implementacja edukacyjna dla małych instancji nie-modularnego modelu LWE.
        Wynik minimum QUBO nie zawsze jest równy wygenerowanemu sekretowi.
      </footer>
    </main>
  );
}

function getChartData(
  trace: readonly SolverStep[],
  activeIndex: number,
): { points: string; currentPoint: { x: number; y: number } | null } | null {
  if (trace.length < 2) {
    return null;
  }
  const energies = trace.flatMap((step) => [step.energy, step.bestEnergy]);
  const minimum = Math.min(...energies);
  const maximum = Math.max(...energies);
  const span = maximum - minimum || 1;
  const points = trace.map((step, index) => ({
    x: 24 + (index / (trace.length - 1)) * 600,
    y: 16 + (1 - (step.energy - minimum) / span) * 176,
  }));
  const currentPoint = points[activeIndex] ?? null;
  return {
    points: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
    currentPoint,
  };
}

function explainStep(
  step: SolverStep,
  solver: SolverName,
  n: number,
): string {
  if (step.event === "final") {
    return `Algorytm zakończył działanie. Najlepszy znaleziony stan ma energię ${step.bestEnergy.toFixed(3)}. Dla brute force jest to globalne minimum; algorytmy heurystyczne nie gwarantują, że sprawdziły każdy możliwy stan.`;
  }

  const foundNewBest = step.event === "best";
  if (solver === "bruteForce") {
    const checked = step.iter + 1;
    const bestText = foundNewBest
      ? "To nowy najlepszy wynik."
      : "Ten kandydat nie poprawił najlepszego wyniku.";
    return `Brute force sprawdza możliwe klucze po kolei. To kandydat ${checked} z ${2 ** n}; jego energia wynosi ${step.energy.toFixed(3)}. ${bestText} Po sprawdzeniu wszystkich ${2 ** n} możliwości algorytm zna globalne minimum.`;
  }

  if (solver === "simulatedAnnealing") {
    if (step.flipped === null || step.deltaE === null) {
      return "Algorytm zaczyna od jednego zgadywanego klucza. Za chwilę spróbuje zmienić jeden jego bit.";
    }
    if (step.deltaE <= 0) {
      return `Algorytm zmienił bit s${step.flipped}. Energia spadła lub pozostała taka sama (zmiana ${step.deltaE.toFixed(3)}), więc ruch został przyjęty. ${foundNewBest ? "To najlepszy wynik znaleziony do tej pory." : ""}`;
    }
    const probability =
      step.temperature === null
        ? 0
        : Math.exp(-step.deltaE / step.temperature);
    const decision =
      step.accepted === true
        ? "Tym razem zaakceptował gorszy ruch — dzięki temu może wydostać się z lokalnej pułapki."
        : "Tym razem odrzucił gorszy ruch i zostaje przy dotychczasowym stanie.";
    return `Próba zmiany bitu s${step.flipped} podniosłaby energię o ${step.deltaE.toFixed(3)}. Przy tej temperaturze szansa akceptacji wynosi około ${(probability * 100).toFixed(1)}%. ${decision}`;
  }

  if (step.flipped === null || step.deltaE === null) {
    return "Tabu search rozpoczyna od zgadywanego klucza. W kolejnych krokach wybierze zmianę, która najlepiej obniża energię i nie jest chwilowo zablokowana.";
  }
  return `Tabu search zmienił bit s${step.flipped} (zmiana energii ${step.deltaE.toFixed(3)}). Ostatnio zmienione bity trafiają na chwilową listę zakazów, żeby algorytm nie cofał się bez końca. ${foundNewBest ? "To najlepszy wynik znaleziony do tej pory." : ""}`;
}

function getTotalIterations(
  solver: SolverName,
  n: number,
  extraInfo: Readonly<Record<string, number | string | boolean>>,
): number {
  if (solver === "bruteForce") {
    return 2 ** n;
  }
  const first =
    solver === "simulatedAnnealing" ? extraInfo.numReads : extraInfo.numRestarts;
  const second =
    solver === "simulatedAnnealing"
      ? extraInfo.numSweeps
      : extraInfo.maxIterations;
  return typeof first === "number" && typeof second === "number"
    ? first * second
    : 0;
}

function coefficientColor(value: number): string {
  const strength = Math.min(0.65, Math.abs(value) / 300);
  return value >= 0
    ? `rgba(217, 119, 87, ${strength})`
    : `rgba(48, 113, 130, ${strength})`;
}

function isSolverName(value: string): value is SolverName {
  return Object.hasOwn(solverLabels, value);
}

export default App;
