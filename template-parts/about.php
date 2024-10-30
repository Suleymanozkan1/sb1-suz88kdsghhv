<?php
/**
 * About Section Template Part
 */
?>

<section id="about" class="py-20 relative overflow-hidden">      
    <div class="container mx-auto px-6 relative">
        <div class="max-w-4xl mx-auto">
            <div class="flex items-center justify-center mb-16">
                <h2 class="text-4xl font-bold text-emerald-800">
                    <?php echo carbon_get_theme_option('about_title'); ?>
                </h2>
            </div>

            <div class="relative">
                <div class="mb-12">
                    <div class="aspect-square max-w-2xl mx-auto rounded-2xl overflow-hidden shadow-lg">
                        <?php 
                        $about_image = carbon_get_theme_option('about_image');
                        if ($about_image): ?>
                            <img 
                                src="<?php echo wp_get_attachment_image_url($about_image, 'full'); ?>"
                                alt="<?php echo carbon_get_theme_option('about_title'); ?>"
                                class="w-full h-full object-cover"
                            />
                        <?php endif; ?>
                    </div>
                </div>

                <div class="space-y-8">
                    <?php 
                    $features = carbon_get_theme_option('about_features');
                    if ($features):
                        foreach ($features as $feature): ?>
                            <div class="bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-lg">
                                <div class="flex items-center space-x-4 mb-4">
                                    <?php get_template_part('template-parts/icons/' . $feature['icon']); ?>
                                    <h3 class="text-2xl font-semibold text-emerald-800">
                                        <?php echo esc_html($feature['title']); ?>
                                    </h3>
                                </div>
                                <p class="text-emerald-700 leading-relaxed">
                                    <?php echo esc_html($feature['content']); ?>
                                </p>
                            </div>
                        <?php endforeach;
                    endif; ?>
                </div>
            </div>
        </div>
    </div>
</section>