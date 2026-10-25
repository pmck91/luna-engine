import type { Project } from './contracts';
const steps = [
  {
    id: 'room',
    title: 'Describe your first room',
    text: 'Name it Workshop and write a short description. This is where the player starts.',
    link: 'Open location',
  },
  {
    id: 'object',
    title: 'Add a bell',
    text: 'Add an object named bell in the Workshop. Describe it as a small brass bell. Its default Examine action prints that description.',
    link: 'Open object',
  },
  {
    id: 'action',
    title: 'Write an interaction',
    text: 'Open Actions, add a command using pull and the bell, then use Add block to insert SAY: “You ring the bell.” Players will type pull bell.',
    link: 'Open actions',
  },
  {
    id: 'condition',
    title: 'Try both branches',
    text: 'Use Add block to insert IF / ELSE. Put a different SAY in each branch. TRUE runs THEN; FALSE runs ELSE. Restart and test both settings.',
    link: 'Open conditions',
  },
  {
    id: 'ending',
    title: 'Give the adventure an ending',
    text: 'Create an ending with a completion message. In the bell action, add END GAME after your other effects and choose that ending.',
    link: 'Open endings',
  },
  {
    id: 'playtest',
    title: 'Play what you made',
    text: 'Start a fresh playtest. Try examine bell, then pull bell. Check the description, the chosen IF branch, and the completion message. Restart to test the other branch.',
    link: 'Open playtest',
  },
  {
    id: 'export',
    title: 'Check and share',
    text: 'Run Validate and repair game errors. Export .luna, import it in the terminal runner, and try the same commands. Draft findings do not block export.',
    link: 'Validate before export',
  },
];
export default function Tutorial({
  project,
  completed,
  setCompleted,
  go,
  dismiss,
}: {
  project: Project;
  completed: string[];
  setCompleted: (steps: string[]) => void;
  go: (step: string) => void;
  dismiss: () => void;
}) {
  return (
    <details className="tutorial-checklist" open>
      <summary>
        First adventure · {completed.length} of {steps.length} reviewed
      </summary>
      <div className="section-heading">
        <p>
          Build a tiny bell adventure in {project.game.title}. Mark each step when you have checked
          its result.
        </p>
        <button onClick={dismiss}>Hide tutorial</button>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            <label>
              <input
                type="checkbox"
                checked={completed.includes(step.id)}
                onChange={(event) =>
                  setCompleted(
                    event.target.checked
                      ? [...completed, step.id]
                      : completed.filter((id) => id !== step.id),
                  )
                }
              />
              {step.title}
            </label>
            <p>{step.text}</p>
            <button onClick={() => go(step.id)}>{step.link}</button>
          </li>
        ))}
      </ol>
    </details>
  );
}
