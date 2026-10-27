import unittest
from browser_target import browser_target, same_origin


class BrowserTargetTests(unittest.TestCase):
    def test_canonical_origins_and_redirect_boundaries(self):
        self.assertEqual(browser_target('https://LOCALHOST:8787'), ('https://localhost:8787', True))
        self.assertEqual(browser_target('https://Example.test:443'), ('https://example.test', False))
        self.assertTrue(same_origin('https://EXAMPLE.test:443/members/#/home', 'https://example.test'))
        self.assertFalse(same_origin('https://example.test.attacker/path', 'https://example.test'))
        self.assertFalse(same_origin('http://example.test/path', 'https://example.test'))
        self.assertFalse(same_origin('https://user@example.test/path', 'https://example.test'))

    def test_exact_loopback_hosts(self):
        for base in ('https://localhost:8787', 'https://127.0.0.1:8787', 'https://[::1]:8787'):
            self.assertEqual(browser_target(base + '/'), (base, True))

    def test_remote_and_deceptive_localhost_names_verify_certificates(self):
        for base in ('https://fhcem-skw-preview.pages.dev', 'https://localhost.example',
                     'https://localhost.evil.example', 'https://127.0.0.1.example',
                     'https://localhost.'):
            self.assertEqual(browser_target(base), (base, False))

    def test_reject_unsafe_or_ambiguous_targets_before_password_prompt(self):
        for base in ('http://localhost:8787', 'http://preview.example',
                     'https://localhost@remote.example', 'https://user:pass@localhost',
                     'https://preview.example/path', 'https://preview.example?q=x',
                     'https://preview.example/#login', 'https://',
                     'https://localhost:invalid', 'https://local\thost',
                     ' https://localhost', 'https://localhost\\@remote.example'):
            with self.subTest(base=base), self.assertRaises(ValueError):
                browser_target(base)


if __name__ == '__main__':
    unittest.main()
