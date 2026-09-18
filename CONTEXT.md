# Jeval evaluation

A Jeval is a named experiment for testing typed judgments against independently reviewed examples.

## Language

**Jeval**:
A collection of questions sharing case state, expected answers, and run history.
_Avoid_: primitive category (for the whole collection)

**Question**:
One typed judgment within a Jeval, identified independently of its position in the collection.

**Case**:
An example containing shared state and expected answers for the questions being tested.

**Expected answer**:
An independently reviewed label or numeric score and rationale used to assess a judgment's correctness. Score answers may include a tolerance defining an acceptable distance from the expected score.
_Avoid_: model prediction

**Noul**:
A probability of yes from zero to one; the question's threshold converts that probability into a yes/no judgment.
_Avoid_: confidence score

**Choice**:
A judgment selecting one option from a named set, accompanied by a probability distribution across the options and a confidence value.
_Avoid_: yes/no probability

**Score**:
A numeric judgment on an ordered rubric whose levels run from zero upward, accompanied by a probability distribution across those levels.

**Request trace**:
The preserved input, response, resources, and failure information for one judgment request, which can contain answers to several questions.

**Answer failure**:
A missing or unusable answer to one question; other answers from the same request may remain usable.

**Run**:
An execution of a saved Jeval with a preserved definition and case snapshot.

**Partial success**:
A finished run containing usable answers and one or more execution or answer failures; an incorrect judgment is still a usable answer.

**Full failure**:
A finished run with no usable answers.

**Best run**:
A fully successful run ranked by accuracy, then lower Brier error, among runs with the same question IDs, types, option labels or ordered rubric levels, case states, and expected answers including tolerances. Equal metrics favor the newest run, then its stable identifier.

**Draft**:
An unsaved Jeval definition that remains available while moving between Jevals; runs use saved definitions.
