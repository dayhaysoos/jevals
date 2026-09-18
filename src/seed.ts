import type { Suite } from "./types.js";
export const seed: Suite = {
  name: "What counts as a sandwich?",
  stateSchema: [
    {
      key: "food",
      label: "Food description",
      type: "text",
      required: true,
      defaultValue: "",
    },
    {
      key: "definition",
      label: "Sandwich definition",
      type: "long-text",
      required: true,
      defaultValue:
        "A sandwich is a filling between two slices of bread or inside a split bread roll. A hinged roll qualifies. Tortillas, wraps, and bowls do not.",
    },
  ],
  model: "jev-1.13.0",
  questions: [
    {
      id: "judgment",
      name: "Question 1",
      type: "noul",
      threshold: 0.5,
      instructions:
        "Does the food described in `food` count as a sandwich under `definition`? Use only this definition.",
      yes: "The described food satisfies the supplied definition, including a split roll with a hinge.",
      no: "The described food does not satisfy the supplied definition.",
    },
  ],
  cases: [
    [
      "hot-dog",
      "Hot dog",
      "A sausage served inside a split bread roll.",
      true,
      "A split roll is explicitly included.",
    ],
    [
      "grilled-cheese",
      "Grilled cheese",
      "Cheese between two slices of bread, toasted.",
      true,
      "Two bread slices with a filling.",
    ],
    [
      "taco",
      "Taco",
      "Beans and vegetables in a folded corn tortilla.",
      false,
      "The definition excludes tortillas.",
    ],
    [
      "salad",
      "Salad",
      "Lettuce, tomatoes, and dressing in a bowl.",
      false,
      "No bread enclosing a filling.",
    ],
    [
      "sub",
      "Sub roll",
      "Meat and vegetables in a hinged split bread roll.",
      true,
      "A filled hinged bread roll qualifies.",
    ],
  ].map(([id, name, food, expected, rationale]) => ({
    id: String(id),
    name: String(name),
    expectations: {
      judgment: { value: Boolean(expected), rationale: String(rationale) },
    },
    state: JSON.stringify(
      {
        food,
        definition:
          "A sandwich is a filling between two slices of bread or inside a split bread roll. A hinged roll qualifies. Tortillas, wraps, and bowls do not.",
      },
      null,
      2,
    ),
  })),
};
