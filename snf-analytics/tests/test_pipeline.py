import unittest

from pipeline import validate
from pipeline.metrics import num, occupancy, overall_rating_steps, recomputed_overall, weighted_health_score
from pipeline.sources import CCN, DATASETS


class Metrics(unittest.TestCase):
    def test_num_blank_is_not_zero(self):
        self.assertIsNone(num(""))
        self.assertIsNone(num(None))
        self.assertIsNone(num("N/A"))
        self.assertEqual(num("0"), 0)
        self.assertEqual(num("3.94651"), 3.94651)
        self.assertEqual(num("1,234"), 1234)

    def test_overall_rating_rules(self):
        self.assertEqual(recomputed_overall(2, 4, 4), 2)
        self.assertEqual(recomputed_overall(3, 5, 5), 5)
        self.assertEqual(recomputed_overall(3, 1, 1), 1)
        self.assertEqual(recomputed_overall(1, 1, 5), 2)   # floor at 1, then +1
        self.assertEqual(recomputed_overall(5, 5, 1), 4)   # ceiling at 5, then -1
        self.assertEqual(recomputed_overall(1, 5, 5), 2)   # 1-star health caps the upgrade
        self.assertEqual(recomputed_overall(4, None, 5), 5)  # missing staffing: no adjustment
        self.assertIsNone(recomputed_overall(None, 5, 5))
        self.assertEqual(len(overall_rating_steps(1, 5, 5)), 4)

    def test_weighted_score(self):
        self.assertEqual(weighted_health_score(56, 8), 44)
        self.assertEqual(weighted_health_score(40, None), 40)
        self.assertIsNone(weighted_health_score(None, 8))

    def test_occupancy(self):
        self.assertAlmostEqual(occupancy(50.0, 57), 0.877193, places=5)
        self.assertIsNone(occupancy(None, 57))
        self.assertIsNone(occupancy(50, 0))


def provider(**kw):
    row = {c: "" for c in DATASETS["provider"]["required"]}
    row.update({CCN: "000001", "State": "AL", "Overall Rating": "2", "Health Inspection Rating": "2",
                "Staffing Rating": "4", "QM Rating": "4", "Rating Cycle 1 Total Health Score": "56",
                "Rating Cycle 2/3 Total Health Score": "8", "Total Weighted Health Survey Score": "44.000",
                "Number of Fines": "1", "Total Amount of Fines in Dollars": "650.00",
                "Number of Payment Denials": "0", "Processing Date": "2026-10-01"})
    row.update(kw)
    return row


class Gates(unittest.TestCase):
    def test_schema_gate_fails_on_renamed_column(self):
        headers = {k: list(v["required"]) for k, v in DATASETS.items()}
        self.assertEqual(validate.check_schema(headers)["status"], "pass")
        headers["provider"].remove("Overall Rating")
        r = validate.check_schema(headers)
        self.assertEqual(r["status"], "fail")
        self.assertIn("Overall Rating", r["detail"])

    def test_star_gate(self):
        self.assertEqual(validate.check_star_rebuild([provider()])["status"], "pass")
        self.assertEqual(validate.check_star_rebuild([provider(**{"Overall Rating": "5"})])["status"], "fail")

    def test_weighted_gate(self):
        self.assertEqual(validate.check_weighted_score([provider()])["status"], "pass")
        self.assertEqual(validate.check_weighted_score([provider(**{"Total Weighted Health Survey Score": "50"})])["status"], "fail")

    def test_penalty_gate(self):
        fine = {CCN: "000001", "Penalty Type": "Fine", "Fine Amount": "650"}
        self.assertEqual(validate.check_penalties([provider()], [fine])["status"], "pass")
        self.assertEqual(validate.check_penalties([provider()], [])["status"], "fail")

    def test_orphan_gate(self):
        data = {k: [] for k in DATASETS}
        data["provider"] = [provider()]
        data["penalties"] = [{CCN: "999999"}]
        self.assertEqual(validate.check_orphans(data)["status"], "fail")

    def test_count_gate_blocks_large_swings(self):
        rows = [provider(**{CCN: f"{i:06d}"}) for i in range(14000)]
        self.assertEqual(validate.check_provider_count(rows, 14100)["status"], "pass")
        self.assertEqual(validate.check_provider_count(rows, 16000)["status"], "fail")
        self.assertEqual(validate.check_provider_count(rows[:100], None)["status"], "fail")

    def test_average_gate(self):
        rows = [provider(**{"Overall Rating": "2"}), provider(**{CCN: "000002", "Overall Rating": "3"})]
        avg = [{"State or Nation": "AL", "Overall Rating": "2.5"}, {"State or Nation": "NATION", "Overall Rating": "2.5"}]
        self.assertEqual(validate.check_averages(rows, avg)[0]["status"], "pass")
        avg[0]["Overall Rating"] = "3.1"
        self.assertEqual(validate.check_averages(rows, avg)[0]["status"], "fail")

    def test_chain_rollup_gate(self):
        base = {"Chain ID": "7", "Number of Facilities in Chain": "2", "Chain Average Overall 5-star Rating": "2.5",
                "Chain Average Health Inspection Rating": "2.0", "Chain Average Staffing Rating": "4.0",
                "Chain Average QM Rating": "4.0"}
        rows = [provider(**base), provider(**dict(base, **{CCN: "000002", "Overall Rating": "3"}))]
        self.assertEqual(validate.check_chain_rollups(rows)["status"], "pass")
        rows[1]["Overall Rating"] = "5"
        self.assertEqual(validate.check_chain_rollups(rows)["status"], "fail")
        self.assertEqual(validate.check_chain_rollups(rows[:1])["status"], "fail")  # count does not tie

    def test_info_checks_never_block(self):
        self.assertTrue(validate.passed([{"status": "warn"}, {"status": "pass"}]))
        self.assertFalse(validate.passed([{"status": "fail"}]))


if __name__ == "__main__":
    unittest.main()
