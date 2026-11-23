import { expect, test } from "bun:test";
import { DataFactory } from "n3";
import { filterQuads } from "./quad-filter.ts";

const { namedNode, quad, defaultGraph } = DataFactory;

test("QuadFilter - compiles empty filter to open match", () => {
  const matcher = filterQuads();
  const sample = quad(
    namedNode("http://s"),
    namedNode("http://p"),
    namedNode("http://o"),
    defaultGraph(),
  );

  expect(matcher(sample)).toStrictEqual(true);
});

test("QuadFilter - restricts matching by positive (include) scope", () => {
  const matcher = filterQuads({
    include: {
      subjects: ["http://s1", "http://s2"],
    },
  });

  const pass = quad(
    namedNode("http://s2"),
    namedNode("http://p"),
    namedNode("http://o"),
    defaultGraph(),
  );

  const fail = quad(
    namedNode("http://s3"),
    namedNode("http://p"),
    namedNode("http://o"),
    defaultGraph(),
  );

  expect(matcher(pass)).toStrictEqual(true);
  expect(matcher(fail)).toStrictEqual(false);
});

test("QuadFilter - restricts matching by negative (exclude) scope", () => {
  const matcher = filterQuads({
    exclude: {
      graphs: ["http://g1"],
    },
  });

  const pass = quad(
    namedNode("http://s"),
    namedNode("http://p"),
    namedNode("http://o"),
    namedNode("http://g2"),
  );

  const fail = quad(
    namedNode("http://s"),
    namedNode("http://p"),
    namedNode("http://o"),
    namedNode("http://g1"),
  );

  expect(matcher(pass)).toStrictEqual(true);
  expect(matcher(fail)).toStrictEqual(false);
});

test("QuadFilter - restricts matching by positive (include) predicate scope", () => {
  const matcher = filterQuads({
    include: {
      predicates: ["http://p-allowed"],
    },
  });

  const pass = quad(
    namedNode("http://s"),
    namedNode("http://p-allowed"),
    namedNode("http://o"),
    defaultGraph(),
  );

  const fail = quad(
    namedNode("http://s"),
    namedNode("http://p-other"),
    namedNode("http://o"),
    defaultGraph(),
  );

  expect(matcher(pass)).toStrictEqual(true);
  expect(matcher(fail)).toStrictEqual(false);
});

test("QuadFilter - restricts matching by negative (exclude) subject scope", () => {
  const matcher = filterQuads({
    exclude: {
      subjects: ["http://s-blocked"],
    },
  });

  const pass = quad(
    namedNode("http://s-allowed"),
    namedNode("http://p"),
    namedNode("http://o"),
    defaultGraph(),
  );

  const fail = quad(
    namedNode("http://s-blocked"),
    namedNode("http://p"),
    namedNode("http://o"),
    defaultGraph(),
  );

  expect(matcher(pass)).toStrictEqual(true);
  expect(matcher(fail)).toStrictEqual(false);
});

test("QuadFilter - intersects multiple combined inclusion/exclusion criteria", () => {
  const matcher = filterQuads({
    include: {
      subjects: ["http://s"],
    },
    exclude: {
      predicates: ["http://p-hidden"],
    },
  });

  const pass = quad(
    namedNode("http://s"),
    namedNode("http://p-visible"),
    namedNode("http://o"),
    defaultGraph(),
  );

  const failBySubject = quad(
    namedNode("http://other"),
    namedNode("http://p-visible"),
    namedNode("http://o"),
    defaultGraph(),
  );

  const failByExclude = quad(
    namedNode("http://s"),
    namedNode("http://p-hidden"),
    namedNode("http://o"),
    defaultGraph(),
  );

  expect(matcher(pass)).toStrictEqual(true);
  expect(matcher(failBySubject)).toStrictEqual(false);
  expect(matcher(failByExclude)).toStrictEqual(false);
});
