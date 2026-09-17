import unittest

from verification_game_sim import (
    Params,
    Population,
    PopulationTaskParams,
    ProviderBehavior,
    RentalParams,
    break_even_rate,
    cheater_ev_closed_form,
    false_heartbeat_ev,
    heartbeat_break_even_rate,
    simulate,
    simulate_population_tasks,
    simulate_rentals,
)


ALL_HONEST = Population(honest=1.0, lazy=0.0, malicious=0.0, colluding=0.0)
ALL_MALICIOUS = Population(honest=0.0, lazy=0.0, malicious=1.0, colluding=0.0)


def behaviors(*, honest_uptime=1.0, malicious_uptime=0.0):
    return {
        "honest": ProviderBehavior(0.0, honest_uptime, 0.0),
        "lazy": ProviderBehavior(0.5, 0.8, 0.0),
        "malicious": ProviderBehavior(1.0, malicious_uptime, 1.0),
        "colluding": ProviderBehavior(1.0, 0.7, 1.0, colluding=True),
    }


class FormulaTests(unittest.TestCase):
    def test_task_break_even_formula(self):
        rate = break_even_rate(100.0, 500.0)
        self.assertAlmostEqual(rate, 1.0 / 6.0)
        self.assertAlmostEqual(cheater_ev_closed_form(100.0, 500.0, rate), 0.0)

    def test_false_heartbeat_break_even_formula(self):
        rate = heartbeat_break_even_rate(10.0, 90.0)
        self.assertAlmostEqual(rate, 0.1)
        self.assertAlmostEqual(false_heartbeat_ev(10.0, 90.0, rate), 0.0)

    def test_formula_edges(self):
        self.assertEqual(break_even_rate(0.0, 100.0), 0.0)
        self.assertEqual(cheater_ev_closed_form(10.0, 5.0, 0.0), 10.0)
        self.assertEqual(cheater_ev_closed_form(10.0, 5.0, 1.0), -5.0)
        with self.assertRaises(ValueError):
            break_even_rate(0.0, 0.0)
        with self.assertRaises(ValueError):
            false_heartbeat_ev(10.0, 10.0, 1.1)

    def test_no_challenger_has_no_effective_spot_check(self):
        result = simulate(Params(10.0, 100.0, 20, 0, 7), 1.0)
        self.assertEqual(result["detection_rate"], 0.0)
        self.assertEqual(result["cheater_ev_sim"], 10.0)
        self.assertEqual(result["cheater_ev_theory"], 10.0)


class PopulationTaskTests(unittest.TestCase):
    def test_reproducible_for_same_seed(self):
        params = PopulationTaskParams(100.0, 200.0, 2_000, 3, 0.4, 17)
        population = Population()
        self.assertEqual(
            simulate_population_tasks(params, population),
            simulate_population_tasks(params, population),
        )

    def test_population_accounting(self):
        params = PopulationTaskParams(100.0, 100.0, 1_000, 3, 0.5, 42)
        result = simulate_population_tasks(params, Population())
        self.assertEqual(
            sum(values["tasks"] for values in result["by_type"].values()),
            params.rounds,
        )
        self.assertEqual(
            sum(values["cheats"] for values in result["by_type"].values()),
            result["cheats"],
        )
        self.assertEqual(
            sum(values["caught"] for values in result["by_type"].values()),
            result["caught"],
        )

    def test_no_challengers_cannot_detect_cheat(self):
        params = PopulationTaskParams(10.0, 100.0, 100, 0, 1.0, 1)
        result = simulate_population_tasks(params, ALL_MALICIOUS)
        self.assertEqual(result["cheats"], 100)
        self.assertEqual(result["caught"], 0)
        self.assertEqual(result["verification_overhead"], 0.0)

    def test_honest_population_does_not_cheat(self):
        params = PopulationTaskParams(10.0, 100.0, 100, 3, 1.0, 1)
        result = simulate_population_tasks(
            params, ALL_HONEST, behaviors=behaviors()
        )
        self.assertEqual(result["cheats"], 0)
        self.assertEqual(result["caught"], 0)

    def test_invalid_population_is_rejected(self):
        params = PopulationTaskParams(10.0, 10.0, 10, 1, 0.5, 1)
        with self.assertRaises(ValueError):
            simulate_population_tasks(
                params,
                Population(honest=0.8, lazy=0.3, malicious=0.0, colluding=0.0),
            )


class RentalTests(unittest.TestCase):
    def test_reproducible_for_same_seed(self):
        params = RentalParams(500, 12, 7.0, 200.0, 0.6, 99)
        population = Population()
        self.assertEqual(
            simulate_rentals(params, population),
            simulate_rentals(params, population),
        )

    def test_escrow_is_conserved_for_population_and_types(self):
        result = simulate_rentals(
            RentalParams(1_000, 24, 10.0, 500.0, 0.75, 42), Population()
        )
        self.assertAlmostEqual(result["conservation_delta"], 0.0)
        self.assertAlmostEqual(result["escrow"], result["paid"] + result["refunded"])
        for values in result["by_type"].values():
            self.assertAlmostEqual(
                values["escrow"], values["paid"] + values["refunded"]
            )

    def test_full_uptime_streams_all_escrow(self):
        params = RentalParams(20, 5, 10.0, 100.0, 1.0, 3)
        result = simulate_rentals(
            params, ALL_HONEST, behaviors=behaviors(honest_uptime=1.0)
        )
        self.assertEqual(result["paid"], 1_000.0)
        self.assertEqual(result["refunded"], 0.0)
        self.assertEqual(result["slashed"], 0.0)
        self.assertEqual(result["terminations"], 0)

    def test_detected_false_heartbeat_refunds_and_slashes(self):
        params = RentalParams(10, 5, 10.0, 100.0, 1.0, 3)
        result = simulate_rentals(
            params,
            ALL_MALICIOUS,
            behaviors=behaviors(malicious_uptime=0.0),
        )
        self.assertEqual(result["paid"], 0.0)
        self.assertEqual(result["refunded"], 500.0)
        self.assertEqual(result["slashed"], 1_000.0)
        self.assertEqual(result["terminations"], 10)
        self.assertEqual(result["false_heartbeats_caught"], 10)

    def test_undetected_false_heartbeat_streams_payment(self):
        params = RentalParams(10, 5, 10.0, 100.0, 0.0, 3)
        result = simulate_rentals(
            params,
            ALL_MALICIOUS,
            behaviors=behaviors(malicious_uptime=0.0),
        )
        self.assertEqual(result["paid"], 500.0)
        self.assertEqual(result["refunded"], 0.0)
        self.assertEqual(result["slashed"], 0.0)
        self.assertEqual(result["terminations"], 0)
        self.assertEqual(result["false_heartbeats"], 50)

    def test_invalid_rental_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            simulate_rentals(
                RentalParams(0, 1, 1.0, 1.0, 0.5, 1), Population()
            )
        with self.assertRaises(ValueError):
            simulate_rentals(
                RentalParams(1, 1, -1.0, 1.0, 0.5, 1), Population()
            )


if __name__ == "__main__":
    unittest.main()
