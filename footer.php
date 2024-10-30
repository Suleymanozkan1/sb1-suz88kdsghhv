<?php
/**
 * Footer Template
 */
?>

<footer class="bg-emerald-900 text-white py-12">
    <div class="container mx-auto px-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
                <h3 class="text-xl font-bold mb-4"><?php bloginfo('name'); ?></h3>
                <p class="text-emerald-200"><?php bloginfo('description'); ?></p>
            </div>
            <div>
                <h3 class="text-xl font-bold mb-4">Quick Links</h3>
                <?php
                wp_nav_menu(array(
                    'theme_location' => 'footer',
                    'container' => false,
                    'menu_class' => 'space-y-2',
                    'link_class' => 'text-emerald-200 hover:text-white transition-colors'
                ));
                ?>
            </div>
            <div>
                <h3 class="text-xl font-bold mb-4">Connect</h3>
                <?php if (get_theme_mod('social_twitter')): ?>
                    <a href="https://x.com/meimeioneth" class="text-emerald-200 hover:text-white transition-colors block mb-2">
                        X/Twitter
                    </a>
                <?php endif; ?>
                <?php if (get_theme_mod('social_telegram')): ?>
                    <a href="<?php echo esc_url(get_theme_mod('social_telegram')); ?>" class="text-emerald-200 hover:text-white transition-colors block">
                        Telegram
                    </a>
                <?php endif; ?>
            </div>
        </div>
        <div class="mt-8 pt-8 border-t border-emerald-800 text-center text-emerald-200">
            <p>&copy; <?php echo date('Y'); ?> <?php bloginfo('name'); ?>. All rights reserved.</p>
        </div>
    </div>
</footer>

<?php wp_footer(); ?>