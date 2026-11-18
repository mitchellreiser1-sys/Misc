import unittest

from tools import apply_portfolio_request as req


class Parse(unittest.TestCase):
    def test_save(self):
        self.assertEqual(req.parse("action: save\nname:  Deal   A \nccns: 15009, 235039;235039 01a193"),
                         ("save", "Deal A", ["015009", "235039", "01A193"]))

    def test_delete_needs_no_ccns(self):
        self.assertEqual(req.parse("Action: DELETE\r\nName: Deal A\r\n"), ("delete", "Deal A", []))

    def test_first_value_wins_and_extra_text_is_ignored(self):
        body = "Please do this\naction: save\nname: Real\nccns: 235039\nname: Injected\n$(rm -rf /)\naction: delete"
        self.assertEqual(req.parse(body), ("save", "Real", ["235039"]))

    def test_rejections(self):
        for bad in ("", "action: publish\nname: x\nccns: 235039", "action: save\nname: \nccns: 235039",
                    "action: save\nname: x\nccns: ", "action: save\nname: x\nccns: 12345678",
                    "action: save\nname: <script>\nccns: 235039", "action: save\nname: " + "x" * 101 + "\nccns: 235039",
                    "action: save\nname: x\nccns: " + ",".join(f"{i:06d}" for i in range(1501))):
            with self.assertRaises(ValueError):
                req.parse(bad)


class Apply(unittest.TestCase):
    BASE = [{"name": "Alpha", "ccns": ["000001"]}, {"name": "Beta 2026", "ccns": ["000002"]}]

    def test_add_update_delete(self):
        out, msg = req.apply(self.BASE, "save", "Gamma", ["000003"])
        self.assertEqual([p["name"] for p in out], ["Alpha", "Beta 2026", "Gamma"])
        self.assertIn("Added", msg)
        out, msg = req.apply(self.BASE, "save", "beta-2026", ["000009", "000008"])     # same portfolio, different punctuation
        self.assertEqual(out, [{"name": "Alpha", "ccns": ["000001"]}, {"name": "beta-2026", "ccns": ["000009", "000008"]}])
        self.assertIn("Updated", msg)
        out, msg = req.apply(self.BASE, "delete", "ALPHA", [])
        self.assertEqual([p["name"] for p in out], ["Beta 2026"])
        self.assertEqual(len(self.BASE), 2)                                            # the input list is not modified

    def test_delete_missing_is_rejected(self):
        with self.assertRaises(ValueError):
            req.apply(self.BASE, "delete", "Nope", [])


if __name__ == "__main__":
    unittest.main()
