/**
 * SEARCH_WORLD_TOOL_DESCRIPTION documents discovery search for AI SDK tools.
 *
 * Keep aligned with the eval harness tool descriptions: worlds-client-evals
 * `src/tools/create-eval-tools.ts` (archived; evaluation continues in
 * wazoo-memorybench).
 */
export const SEARCH_WORLD_TOOL_DESCRIPTION =
  "Discovery search: use first to find candidate subject IRIs from labels, keywords, or entity names. Each hit includes subject, predicate, and graph IRIs; text is the object literal only (not a paraphrased fact). Pass discovered subject values into executeSparql — do not invent URIs. Do not treat text alone as ground truth.";

/**
 * EXECUTE_SPARQL_TOOL_DESCRIPTION documents read-only SPARQL traversal for AI SDK tools.
 *
 * Keep aligned with the eval harness tool descriptions: worlds-client-evals
 * `src/tools/create-eval-tools.ts` (archived; evaluation continues in
 * wazoo-memorybench).
 */
export const EXECUTE_SPARQL_TOOL_DESCRIPTION =
  "Execute a read-only SPARQL SELECT or ASK against the RDF graph. Use after searchWorld on IRIs from search results (subject field). To inspect a resource, use SELECT ?p ?o WHERE { <uri> ?p ?o }. Final answers must use exact literal binding values from results.";
