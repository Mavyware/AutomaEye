<?php
declare(strict_types=1);

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as PHPMailerException;

final class Mailer
{
    /**
     * Sends an email via the hosting mailbox (SMTP) when configured, otherwise
     * logs it with error_log() so local dev keeps working without credentials.
     */
    public static function send(string $toEmail, string $toName, string $subject, string $bodyHtml, string $bodyText): bool
    {
        if (MAIL_MAILER !== 'smtp' || !MAIL_HOST || !class_exists(PHPMailer::class)) {
            error_log("[AutomaEyes] Mail (not sent, mailer=" . MAIL_MAILER . ") to {$toEmail}: {$subject}\n{$bodyText}");
            return MAIL_MAILER === 'log';
        }

        $mail = new PHPMailer(true);

        try {
            $mail->isSMTP();
            $mail->Host = MAIL_HOST;
            $mail->Port = MAIL_PORT;
            $mail->SMTPAuth = true;
            $mail->Username = MAIL_USERNAME;
            $mail->Password = MAIL_PASSWORD;
            $mail->SMTPSecure = MAIL_ENCRYPTION === 'ssl' ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
            $mail->CharSet = 'UTF-8';
            $mail->Timeout = 10;

            $mail->setFrom(MAIL_FROM_ADDRESS, MAIL_FROM_NAME);
            $mail->addAddress($toEmail, $toName);

            $mail->isHTML(true);
            $mail->Subject = $subject;
            $mail->Body = $bodyHtml;
            $mail->AltBody = $bodyText;

            $mail->send();
            return true;
        } catch (PHPMailerException $e) {
            error_log('[AutomaEyes] Mail send failed to ' . $toEmail . ': ' . $mail->ErrorInfo);
            return false;
        }
    }

    public static function sendPasswordReset(string $toEmail, string $toName, string $resetLink): bool
    {
        $subject = 'Reset your ' . APP_NAME . ' password';

        $bodyHtml = '<p>Hi ' . htmlspecialchars($toName, ENT_QUOTES) . ',</p>'
            . '<p>Someone requested a password reset for your ' . htmlspecialchars(APP_NAME, ENT_QUOTES) . ' account. '
            . 'Click the link below to choose a new password. This link expires in 1 hour.</p>'
            . '<p><a href="' . htmlspecialchars($resetLink, ENT_QUOTES) . '">Reset your password</a></p>'
            . '<p>If you didn\'t request this, you can safely ignore this email.</p>';

        $bodyText = "Hi {$toName},\n\n"
            . "Someone requested a password reset for your " . APP_NAME . " account.\n"
            . "Open this link to choose a new password (expires in 1 hour):\n\n{$resetLink}\n\n"
            . "If you didn't request this, you can safely ignore this email.";

        return self::send($toEmail, $toName, $subject, $bodyHtml, $bodyText);
    }
}
